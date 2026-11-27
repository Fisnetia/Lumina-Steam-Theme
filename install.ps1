<#
.SYNOPSIS
    Lumina Steam Theme one-click installer / updater for Windows.
.DESCRIPTION
    Detects Steam path, checks installed Millennium and Lumina versions, auto-detects
    local proxy or GitHub mirrors if GitHub is unreachable, downloads only needed updates
    (with SHA-256 verification) BEFORE stopping Steam, installs and enables Lumina +
    lumina-extended in config.json (with backup), and restarts Steam.
.EXAMPLE
    irm https://raw.githubusercontent.com/Fisnetia/Lumina-Steam-Theme/main/install.ps1 | iex
.EXAMPLE
    .\install.ps1 -Proxy "http://127.0.0.1:7890"
.EXAMPLE
    .\install.ps1 -Mirror "https://gh-proxy.org/" -Force
.EXAMPLE
    .\install.ps1 -NoPlugin -SkipMillennium
#>
[CmdletBinding()]
param(
    [string]$SteamPath = "",
    [string]$LocalZip = "",
    [string]$LocalDir = "",
    [string]$Proxy = "",
    [string]$Mirror = "",
    [string[]]$SteamArgs = @(),
    [switch]$SkipMillennium,
    [switch]$NoPlugin,
    [switch]$NoRestart,
    [switch]$Force,
    [switch]$Pause
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Ensure TLS 1.2 on Windows PowerShell 5.1
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$IsZh = [System.Globalization.CultureInfo]::CurrentUICulture.Name -like "zh*"
$script:ActiveProxy = ""
$script:ActiveMirror = ""

$DEFAULT_MIRRORS = @(
    "https://gh-proxy.org/",
    "https://hk.gh-proxy.org/",
    "https://gh-proxy.com/"
)

$COMMON_PROXY_PORTS = @(7897, 7890, 10809, 10808, 2080, 12334, 20171, 1081, 1080, 8080, 10801)

function Msg([string]$zh, [string]$en) {
    if ($IsZh) { return $zh }
    return $en
}

function Write-Step([int]$n, [int]$total, [string]$text) {
    Write-Host ""
    Write-Host ("[{0}/{1}] {2}" -f $n, $total, $text) -ForegroundColor Cyan
}

function Write-Ok([string]$text) {
    Write-Host ("  [OK] {0}" -f $text) -ForegroundColor Green
}

function Write-Info([string]$text) {
    Write-Host ("  [*]  {0}" -f $text) -ForegroundColor Gray
}

function Write-Warn([string]$text) {
    Write-Host ("  [!]  {0}" -f $text) -ForegroundColor Yellow
}

function Write-Err([string]$text) {
    Write-Host ("  [X]  {0}" -f $text) -ForegroundColor Red
}

# ---- SemVer comparison ----

function Parse-SemVer([string]$ver) {
    if ([string]::IsNullOrWhiteSpace($ver)) { return $null }
    $s = $ver.Trim().TrimStart("v", "V")
    if ($s -match "^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z\.-]+))?") {
        return [pscustomobject]@{
            Major = [int]$Matches[1]
            Minor = [int]$Matches[2]
            Patch = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
            Pre   = if ($Matches[4]) { [string]$Matches[4] } else { "" }
            Raw   = $ver.Trim()
        }
    }
    return $null
}

# Returns -1 if a < b, 0 if a == b, 1 if a > b
function Compare-SemVer([string]$a, [string]$b) {
    $va = Parse-SemVer $a
    $vb = Parse-SemVer $b
    if ($null -eq $va -and $null -eq $vb) { return 0 }
    if ($null -eq $va) { return -1 }
    if ($null -eq $vb) { return 1 }

    foreach ($k in @("Major", "Minor", "Patch")) {
        if ($va.$k -lt $vb.$k) { return -1 }
        if ($va.$k -gt $vb.$k) { return 1 }
    }
    if ($va.Pre -eq $vb.Pre) { return 0 }
    if ([string]::IsNullOrEmpty($va.Pre)) { return 1 }   # stable > prerelease
    if ([string]::IsNullOrEmpty($vb.Pre)) { return -1 }  # prerelease < stable

    $pa = $va.Pre.Split(".")
    $pb = $vb.Pre.Split(".")
    $len = [Math]::Max($pa.Length, $pb.Length)
    for ($i = 0; $i -lt $len; $i++) {
        if ($i -ge $pa.Length) { return -1 }
        if ($i -ge $pb.Length) { return 1 }
        $na = 0; $nb = 0
        $ia = [int]::TryParse($pa[$i], [ref]$na)
        $ib = [int]::TryParse($pb[$i], [ref]$nb)
        if ($ia -and $ib) {
            if ($na -lt $nb) { return -1 }
            if ($na -gt $nb) { return 1 }
        } else {
            $cmp = [string]::Compare($pa[$i], $pb[$i], [System.StringComparison]::OrdinalIgnoreCase)
            if ($cmp -lt 0) { return -1 }
            if ($cmp -gt 0) { return 1 }
        }
    }
    return 0
}

# ---- Steam detection & installed state ----

function Resolve-SteamPath([string]$explicit) {
    $candidates = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($explicit)) {
        $candidates.Add($explicit.Trim().Trim('"'))
    }

    # 1. Running steam.exe exact path
    try {
        $proc = Get-Process -Name "steam" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($proc -and $proc.Path) {
            $candidates.Add([System.IO.Path]::GetDirectoryName($proc.Path))
        }
    } catch {}

    # 2. Windows Registry
    $regPaths = @(
        @{ Key = "HKCU:\Software\Valve\Steam"; Name = "SteamPath" },
        @{ Key = "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam"; Name = "InstallPath" },
        @{ Key = "HKLM:\SOFTWARE\Valve\Steam"; Name = "InstallPath" }
    )
    foreach ($rp in $regPaths) {
        try {
            $val = (Get-ItemProperty -Path $rp.Key -Name $rp.Name -ErrorAction SilentlyContinue).($rp.Name)
            if (-not [string]::IsNullOrWhiteSpace($val)) {
                $candidates.Add(($val -replace "/", "\"))
            }
        } catch {}
    }

    # 3. Common folders across all fixed drives
    try {
        $drives = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq "Fixed" -and $_.IsReady }
        foreach ($d in $drives) {
            $root = $d.RootDirectory.FullName
            $candidates.Add((Join-Path $root "Program Files (x86)\Steam"))
            $candidates.Add((Join-Path $root "Program Files\Steam"))
            $candidates.Add((Join-Path $root "Steam"))
            $candidates.Add((Join-Path $root "Games\Steam"))
        }
    } catch {
        foreach ($fallback in @("C:\Program Files (x86)\Steam", "C:\Program Files\Steam", "D:\Steam", "E:\Steam")) {
            $candidates.Add($fallback)
        }
    }

    $seen = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($dir in $candidates) {
        if ([string]::IsNullOrWhiteSpace($dir)) { continue }
        $norm = $dir.TrimEnd("\")
        if (-not $seen.Add($norm)) { continue }
        if (Test-Path -LiteralPath (Join-Path $norm "steam.exe")) {
            return (Resolve-Path -LiteralPath $norm).Path
        }
    }

    while ($true) {
        $inputPath = Read-Host (Msg "未自动找到 Steam 目录，请输入 Steam 安装路径（含 steam.exe）" "Steam directory not found. Enter Steam install path (containing steam.exe)")
        $inputPath = $inputPath.Trim().Trim('"')
        if (-not [string]::IsNullOrWhiteSpace($inputPath) -and (Test-Path -LiteralPath (Join-Path $inputPath "steam.exe"))) {
            return (Resolve-Path -LiteralPath $inputPath).Path
        }
        Write-Err (Msg "路径无效，未找到 steam.exe：$inputPath" "Invalid path, steam.exe not found: $inputPath")
    }
}

function Test-IsAdmin() {
    try {
        $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object System.Security.Principal.WindowsPrincipal($id)
        return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Invoke-SelfElevate([string]$resolvedSteamDir) {
    $hostExe = if ($PSVersionTable.PSEdition -eq "Core") { "pwsh.exe" } else { "powershell.exe" }
    $argList = New-Object System.Collections.Generic.List[string]
    $argList.Add("-NoProfile")
    $argList.Add("-ExecutionPolicy")
    $argList.Add("Bypass")

    $quote = {
        param([string]$s)
        return '"' + ($s -replace '"', '\"') + '"'
    }

    if (-not [string]::IsNullOrWhiteSpace($PSCommandPath) -and (Test-Path -LiteralPath $PSCommandPath)) {
        $argList.Add("-File")
        $argList.Add((& $quote $PSCommandPath))
        if ($resolvedSteamDir) { $argList.Add("-SteamPath"); $argList.Add((& $quote $resolvedSteamDir)) }
        if ($LocalZip)         { $argList.Add("-LocalZip");  $argList.Add((& $quote $LocalZip)) }
        if ($LocalDir)         { $argList.Add("-LocalDir");  $argList.Add((& $quote $LocalDir)) }
        if ($Proxy)            { $argList.Add("-Proxy");     $argList.Add((& $quote $Proxy)) }
        if ($Mirror)           { $argList.Add("-Mirror");    $argList.Add((& $quote $Mirror)) }
        if ($SkipMillennium)   { $argList.Add("-SkipMillennium") }
        if ($NoPlugin)         { $argList.Add("-NoPlugin") }
        if ($NoRestart)        { $argList.Add("-NoRestart") }
        if ($Force)            { $argList.Add("-Force") }
        $argList.Add("-Pause")
    } else {
        # Invoked via `irm ... | iex` without a script file on disk
        $cmd = '$env:LUMINA_PAUSE = "1"; irm https://raw.githubusercontent.com/Fisnetia/Lumina-Steam-Theme/main/install.ps1 | iex'
        $argList.Add("-Command")
        $argList.Add((& $quote $cmd))
    }

    Write-Warn (Msg "需要管理员权限写入 $resolvedSteamDir，正在请求 UAC 提权..." "Administrator privileges required for $resolvedSteamDir; requesting UAC elevation...")
    try {
        Start-Process -FilePath $hostExe -ArgumentList ($argList -join " ") -Verb RunAs | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-BeforeExit() {
    if (-not $Pause -and $env:LUMINA_PAUSE -ne "1") { return }
    Write-Host ""
    Write-Host (Msg "按任意键关闭窗口..." "Press any key to close...") -ForegroundColor DarkGray
    try {
        [void][System.Console]::ReadKey($true)
    } catch {
        try { Read-Host | Out-Null } catch {}
    }
}

function Test-Writable([string]$dir) {
    $probe = Join-Path $dir (".lumina_write_test_" + [Guid]::NewGuid().ToString("N"))
    try {
        [System.IO.File]::WriteAllText($probe, "ok")
        Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        return $true
    } catch {
        return $false
    }
}

function Get-InstalledState([string]$steamDir) {
    # Millennium version from DLL/EXE VersionInfo
    $milVer = ""
    $milInstalled = $false
    $milFiles = @(
        (Join-Path $steamDir "millennium\lib\millennium.dll"),
        (Join-Path $steamDir "millennium\lib\millennium.hhx64.dll"),
        (Join-Path $steamDir "millennium\bin\millennium.luavm64.exe")
    )
    foreach ($f in $milFiles) {
        if (Test-Path -LiteralPath $f) {
            $milInstalled = $true
            try {
                $vi = (Get-Item -LiteralPath $f).VersionInfo
                $cand = if ($vi.ProductVersion) { $vi.ProductVersion } else { $vi.FileVersion }
                if (-not [string]::IsNullOrWhiteSpace($cand) -and (Parse-SemVer $cand)) {
                    $milVer = $cand.Trim()
                    break
                }
            } catch {}
        }
    }

    # Lumina theme version
    $lumVer = ""
    $skinJson = Join-Path $steamDir "millennium\themes\lumina\skin.json"
    if (Test-Path -LiteralPath $skinJson) {
        try {
            $skin = ([System.IO.File]::ReadAllText($skinJson, [System.Text.Encoding]::UTF8)) | ConvertFrom-Json
            if ($skin.version) { $lumVer = [string]$skin.version }
        } catch {}
    }

    # Companion plugin state
    $pluginJson = Join-Path $steamDir "millennium\plugins\lumina-extended\plugin.json"
    $pluginInstalled = Test-Path -LiteralPath $pluginJson
    $pluginVer = ""
    if ($pluginInstalled) {
        try {
            $pj = ([System.IO.File]::ReadAllText($pluginJson, [System.Text.Encoding]::UTF8)) | ConvertFrom-Json
            if ($pj.version) { $pluginVer = [string]$pj.version }
        } catch {}
    }

    # Config state + optional Millennium proxy setting
    $cfgPath = Join-Path $steamDir "millennium\config\config.json"
    $themeActive = $false
    $pluginEnabled = $false
    $milProxy = ""
    if (Test-Path -LiteralPath $cfgPath) {
        try {
            $cfg = ([System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::UTF8)) | ConvertFrom-Json
            if ($cfg.themes -and $cfg.themes.activeTheme -eq "lumina" -and
                $cfg.themes.allowedStyles -eq $true -and $cfg.themes.allowedScripts -eq $true -and
                $cfg.general -and $cfg.general.injectCSS -eq $true -and $cfg.general.injectJavascript -eq $true) {
                $themeActive = $true
            }
            if ($cfg.plugins -and $cfg.plugins.enabledPlugins) {
                if (@($cfg.plugins.enabledPlugins) -contains "lumina-extended") {
                    $pluginEnabled = $true
                }
            }
            if ($cfg.network -and $cfg.network.proxy) {
                $milProxy = [string]$cfg.network.proxy
            }
        } catch {}
    }

    return [pscustomobject]@{
        MillenniumInstalled = $milInstalled
        MillenniumVersion   = $milVer
        LuminaInstalled     = (Test-Path -LiteralPath $skinJson)
        LuminaVersion       = $lumVer
        PluginInstalled     = $pluginInstalled
        PluginVersion       = $pluginVer
        ThemeActive         = $themeActive
        PluginEnabled       = $pluginEnabled
        MillenniumProxy     = $milProxy
    }
}

# ---- Network, proxy auto-detection & GitHub mirror fallback ----

function Normalize-ProxyUrl([string]$p) {
    if ([string]::IsNullOrWhiteSpace($p)) { return "" }
    $s = $p.Trim()
    # Windows Internet Settings may store per-protocol entries like "http=127.0.0.1:7890;https=127.0.0.1:7890"
    if ($s -match "(?:^|;)https=([^;]+)") {
        $s = $Matches[1].Trim()
    } elseif ($s -match "(?:^|;)http=([^;]+)") {
        $s = $Matches[1].Trim()
    } elseif ($s -match ";") {
        $s = ($s -split ";")[0].Trim()
    }
    if ($s -match "^socks") { return "" }  # System.Net.WebProxy only supports HTTP/HTTPS proxies
    if ($s -notmatch "^https?://") { $s = "http://" + $s }
    try {
        $u = [Uri]$s
        return $u.AbsoluteUri.TrimEnd("/")
    } catch {
        return ""
    }
}

function Test-LocalPortOpen([int]$port, [int]$timeoutMs = 150) {
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $ar = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if ($ar.AsyncWaitHandle.WaitOne($timeoutMs, $false) -and $client.Connected) {
            $client.EndConnect($ar)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        if ($client) { try { $client.Close() } catch {} }
    }
}

function Test-UrlReachable([string]$url, [string]$proxyUrl = "", [int]$timeoutSec = 6) {
    $req = $null
    $resp = $null
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Method = "HEAD"
        $req.AllowAutoRedirect = $false
        $req.UserAgent = "Lumina-Installer"
        $req.Timeout = $timeoutSec * 1000
        $req.ReadWriteTimeout = $timeoutSec * 1000
        if (-not [string]::IsNullOrWhiteSpace($proxyUrl)) {
            $req.Proxy = New-Object System.Net.WebProxy($proxyUrl)
        }
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        return ($code -ge 200 -and $code -lt 400)
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode
            $_.Exception.Response.Close()
            return ($code -ge 200 -and $code -lt 400)
        }
        return $false
    } catch {
        return $false
    } finally {
        if ($resp) { $resp.Close() }
    }
}

function Test-MirrorReachable([string]$mirrorPrefix, [int]$timeoutSec = 7) {
    $url = $mirrorPrefix.TrimEnd("/") + "/https://github.com/Fisnetia/Lumina-Steam-Theme/releases.atom"
    $prev = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
        $r = Invoke-WebRequest -Uri $url -Headers @{ "User-Agent" = "Lumina-Installer" } -UseBasicParsing -TimeoutSec $timeoutSec
        return ($r.StatusCode -eq 200 -and ([string]$r.Content) -match "<feed")
    } catch {
        return $false
    } finally {
        $ProgressPreference = $prev
    }
}

function Get-CandidateProxies([string]$millenniumProxy) {
    $list = New-Object System.Collections.Generic.List[string]
    $seen = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    $add = {
        param([string]$raw)
        $norm = Normalize-ProxyUrl $raw
        if (-not [string]::IsNullOrWhiteSpace($norm) -and $seen.Add($norm)) {
            $list.Add($norm)
        }
    }

    # 1. Explicit env vars
    foreach ($envName in @("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy")) {
        $v = [Environment]::GetEnvironmentVariable($envName)
        if ($v) { & $add $v }
    }

    # 2. Windows Internet Settings system proxy
    try {
        $inet = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction SilentlyContinue
        if ($inet -and $inet.ProxyEnable -eq 1 -and $inet.ProxyServer) {
            & $add ([string]$inet.ProxyServer)
        }
    } catch {}

    # 3. Millennium's own configured proxy
    if ($millenniumProxy) { & $add $millenniumProxy }

    # 4. Locally listening common proxy ports (Clash/Mihomo, v2rayN, Sing-box, SSR, etc.)
    foreach ($port in $COMMON_PROXY_PORTS) {
        if (Test-LocalPortOpen $port) {
            & $add ("http://127.0.0.1:" + $port)
        }
    }

    return ,$list.ToArray()
}

function Initialize-Network([string]$millenniumProxy) {
    $probeUrl = "https://github.com/Fisnetia/Lumina-Steam-Theme/releases/latest"

    # Explicit user mirror
    if (-not [string]::IsNullOrWhiteSpace($Mirror)) {
        $script:ActiveMirror = $Mirror.TrimEnd("/") + "/"
        if (-not [string]::IsNullOrWhiteSpace($Proxy)) {
            $script:ActiveProxy = Normalize-ProxyUrl $Proxy
        }
        Write-Ok (Msg "使用指定镜像源：$($script:ActiveMirror)" "Using specified mirror: $($script:ActiveMirror)")
        return
    }

    # Explicit user proxy
    if (-not [string]::IsNullOrWhiteSpace($Proxy)) {
        $p = Normalize-ProxyUrl $Proxy
        if ([string]::IsNullOrWhiteSpace($p)) {
            throw (Msg "代理地址无效：$Proxy（仅支持 http:// 或 https:// 代理）" "Invalid proxy URL: $Proxy (HTTP/HTTPS proxy required)")
        }
        $script:ActiveProxy = $p
        Write-Ok (Msg "使用指定代理：$p" "Using specified proxy: $p")
        return
    }

    # 1. Try direct / default system route
    Write-Info (Msg "正在测试 GitHub 直连..." "Testing direct connection to GitHub...")
    if (Test-UrlReachable $probeUrl "" 5) {
        Write-Ok (Msg "GitHub 连接正常" "GitHub reachable directly")
        return
    }

    # 2. Auto-detect local proxy (env / Windows system proxy / Millennium proxy / Clash / v2rayN / etc.)
    Write-Warn (Msg "GitHub 直连超时或失败，正在自动检测本机代理..." "Direct connection to GitHub failed; probing local proxies...")
    $proxies = Get-CandidateProxies $millenniumProxy
    foreach ($p in $proxies) {
        Write-Info (Msg "尝试代理：$p" "Trying proxy: $p")
        if (Test-UrlReachable $probeUrl $p 6) {
            $script:ActiveProxy = $p
            Write-Ok (Msg "已自动连接代理：$p" "Connected via local proxy: $p")
            return
        }
    }

    # 3. Auto-probe public GitHub mirrors (verify real 200 Atom response, not bogus redirects)
    Write-Warn (Msg "未找到可用本机代理，正在尝试 GitHub 加速镜像..." "No working local proxy found; probing GitHub mirrors...")
    foreach ($m in $DEFAULT_MIRRORS) {
        Write-Info (Msg "尝试镜像：$m" "Trying mirror: $m")
        if (Test-MirrorReachable $m 7) {
            $script:ActiveMirror = $m.TrimEnd("/") + "/"
            Write-Ok (Msg "已自动切换至镜像源：$($script:ActiveMirror)" "Using GitHub mirror: $($script:ActiveMirror)")
            return
        }
    }

    # 4. Interactive fallback (Steam has NOT been closed yet!)
    Write-Err (Msg "无法连接 GitHub，且自动探测代理与镜像均失败。" "Unable to reach GitHub directly, via local proxy, or via mirrors.")
    $manual = Read-Host (Msg "请输入本机代理（如 http://127.0.0.1:7890）或镜像前缀（如 https://gh-proxy.org/），直接回车退出" "Enter HTTP proxy (e.g. http://127.0.0.1:7890) or mirror URL, or press Enter to exit")
    $manual = $manual.Trim()
    if ([string]::IsNullOrWhiteSpace($manual)) {
        throw (Msg "网络不可用，安装已取消（Steam 未受影响）。" "Network unavailable; installation cancelled (Steam was not closed).")
    }
    if ($manual -match "^https?://(127\.0\.0\.1|localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?/?$" -or $manual -match "^(127\.0\.0\.1|localhost):\d+$") {
        $script:ActiveProxy = Normalize-ProxyUrl $manual
        Write-Ok (Msg "使用代理：$($script:ActiveProxy)" "Using proxy: $($script:ActiveProxy)")
    } else {
        $script:ActiveMirror = $manual.TrimEnd("/") + "/"
        Write-Ok (Msg "使用镜像源：$($script:ActiveMirror)" "Using mirror: $($script:ActiveMirror)")
    }
}

function Apply-Mirror([string]$url) {
    if ([string]::IsNullOrWhiteSpace($script:ActiveMirror)) { return $url }
    return $script:ActiveMirror + $url
}

function Get-LatestTagFromAtom([string]$repo) {
    $url = Apply-Mirror "https://github.com/$repo/releases.atom"
    $prev = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
        $params = @{ Uri = $url; Headers = @{ "User-Agent" = "Lumina-Installer" }; UseBasicParsing = $true; TimeoutSec = 15 }
        if (-not [string]::IsNullOrWhiteSpace($script:ActiveProxy)) { $params.Proxy = $script:ActiveProxy }
        $r = Invoke-WebRequest @params
        $xml = [string]$r.Content
        $matches = [regex]::Matches($xml, "/releases/tag/([^/?#`"'\s<>]+)")
        $firstAny = ""
        foreach ($m in $matches) {
            $t = [Uri]::UnescapeDataString($m.Groups[1].Value)
            if ([string]::IsNullOrEmpty($firstAny)) { $firstAny = $t }
            # Prefer latest stable release (skip -beta / -alpha / -rc / -dev)
            if ($t -notmatch "-(alpha|beta|rc|dev|pre)") {
                return $t
            }
        }
        if (-not [string]::IsNullOrEmpty($firstAny)) { return $firstAny }
    } finally {
        $ProgressPreference = $prev
    }
    throw "Atom feed did not contain a release tag for $repo"
}

function Get-LatestTagByRedirect([string]$repo) {
    $url = Apply-Mirror "https://github.com/$repo/releases/latest"
    for ($hop = 0; $hop -lt 4; $hop++) {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Method = "HEAD"
        $req.AllowAutoRedirect = $false
        $req.UserAgent = "Lumina-Installer"
        $req.Timeout = 15000
        if (-not [string]::IsNullOrWhiteSpace($script:ActiveProxy)) {
            $req.Proxy = New-Object System.Net.WebProxy($script:ActiveProxy)
        }
        $resp = $null
        $loc = ""
        try {
            $resp = $req.GetResponse()
            $loc = $resp.Headers["Location"]
        } catch [System.Net.WebException] {
            if ($_.Exception.Response) {
                $loc = $_.Exception.Response.Headers["Location"]
                $_.Exception.Response.Close()
            } else {
                throw
            }
        } finally {
            if ($resp) { $resp.Close() }
        }
        if ([string]::IsNullOrWhiteSpace($loc)) { break }
        if ($loc -match "/releases/tag/([^/?#]+)") {
            return $Matches[1]
        }
        if ($loc -match "^https?://") {
            $url = $loc
        } else {
            break
        }
    }
    throw "Unable to resolve latest release tag for $repo"
}

function Get-GitHubRelease([string]$repo, [string]$assetPattern, [string]$fallbackAssetBuilder) {
    $headers = @{ "User-Agent" = "Lumina-Installer"; "Accept" = "application/vnd.github+json" }
    $apiUrl = Apply-Mirror "https://api.github.com/repos/$repo/releases/latest"
    try {
        $params = @{ Uri = $apiUrl; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 15 }
        if (-not [string]::IsNullOrWhiteSpace($script:ActiveProxy)) { $params.Proxy = $script:ActiveProxy }
        $rel = Invoke-RestMethod @params
        $tag = [string]$rel.tag_name
        $asset = $rel.assets | Where-Object { $_.name -like $assetPattern } | Select-Object -First 1
        if (-not $asset) {
            throw "Release $tag for $repo has no asset matching $assetPattern"
        }
        $sha256 = ""
        if ($asset.PSObject.Properties.Name -contains "digest" -and $asset.digest -and $asset.digest -like "sha256:*") {
            $sha256 = $asset.digest.Substring(7).Trim().ToLowerInvariant()
        }
        $shaAsset = $rel.assets | Where-Object { $_.name -eq ($asset.name -replace "\.zip$", ".sha256") } | Select-Object -First 1
        return [pscustomobject]@{
            Tag       = $tag
            AssetName = [string]$asset.name
            Url       = [string]$asset.browser_download_url
            Sha256    = $sha256
            ShaUrl    = if ($shaAsset) { [string]$shaAsset.browser_download_url } else { "" }
        }
    } catch {
        # Fallback 1: releases.atom (no API rate limit, works through gh-proxy mirrors)
        # Fallback 2: HTTP redirect chain on releases/latest
    }

    $tag = ""
    try {
        $tag = Get-LatestTagFromAtom $repo
    } catch {
        $tag = Get-LatestTagByRedirect $repo
    }
    $ver = $tag.TrimStart("v", "V")
    $name = $fallbackAssetBuilder.Replace("{tag}", $tag).Replace("{ver}", $ver)
    $base = "https://github.com/$repo/releases/download/$tag/$name"
    $shaUrl = if ($name -like "millennium-*.zip") { $base -replace "\.zip$", ".sha256" } else { "" }
    return [pscustomobject]@{
        Tag       = $tag
        AssetName = $name
        Url       = $base
        Sha256    = ""
        ShaUrl    = $shaUrl
    }
}

function Download-File([string]$url, [string]$dest) {
    $effectiveUrl = Apply-Mirror $url
    $prevProgress = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
        $params = @{
            Uri             = $effectiveUrl
            OutFile         = $dest
            Headers         = @{ "User-Agent" = "Lumina-Installer" }
            UseBasicParsing = $true
            TimeoutSec      = 180
        }
        if (-not [string]::IsNullOrWhiteSpace($script:ActiveProxy)) {
            $params.Proxy = $script:ActiveProxy
        }
        Invoke-WebRequest @params
    } finally {
        $ProgressPreference = $prevProgress
    }
}

# ---- Process, zip & config helpers ----

function Stop-SteamGracefully([string]$steamDir) {
    $running = @(Get-Process -Name "steam", "steamwebhelper" -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) {
        Write-Ok (Msg "Steam 当前未运行" "Steam is not running")
        return
    }

    $steamExe = Join-Path $steamDir "steam.exe"
    Write-Info (Msg "正在请求 Steam 安全退出..." "Requesting Steam to shut down cleanly...")
    try {
        Start-Process -FilePath $steamExe -ArgumentList "-shutdown" -WindowStyle Hidden -ErrorAction SilentlyContinue
    } catch {}

    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        if (@(Get-Process -Name "steam", "steamwebhelper" -ErrorAction SilentlyContinue).Count -eq 0) {
            break
        }
    }

    $still = @(Get-Process -Name "steam", "steamwebhelper" -ErrorAction SilentlyContinue)
    if ($still.Count -gt 0) {
        Write-Warn (Msg "等待超时，正在强制结束残留 Steam 进程..." "Shutdown timed out; terminating remaining Steam processes...")
        $still | Stop-Process -Force -ErrorAction SilentlyContinue
        $killDeadline = (Get-Date).AddSeconds(8)
        while ((Get-Date) -lt $killDeadline) {
            Start-Sleep -Milliseconds 300
            if (@(Get-Process -Name "steam", "steamwebhelper" -ErrorAction SilentlyContinue).Count -eq 0) {
                break
            }
        }
    }

    if (@(Get-Process -Name "steam", "steamwebhelper" -ErrorAction SilentlyContinue).Count -gt 0) {
        throw (Msg "无法关闭 Steam 进程，请手动完全退出 Steam 后重试。" "Could not close Steam processes. Please exit Steam manually and retry.")
    }

    Start-Sleep -Milliseconds 800
    Write-Ok (Msg "Steam 已完全退出" "Steam stopped")
}

function Extract-ZipSafe([string]$zipPath, [string]$destDir) {
    $fullDest = [System.IO.Path]::GetFullPath($destDir)
    if (-not $fullDest.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $fullDest += [System.IO.Path]::DirectorySeparatorChar
    }
    [System.IO.Directory]::CreateDirectory($fullDest) | Out-Null

    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($entry in $archive.Entries) {
            $rel = $entry.FullName -replace "/", "\"
            if ([string]::IsNullOrWhiteSpace($rel)) { continue }
            $target = [System.IO.Path]::GetFullPath((Join-Path $fullDest $rel))
            if (-not $target.StartsWith($fullDest, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Unsafe zip entry path: $($entry.FullName)"
            }
            if ($entry.FullName.EndsWith("/") -or [string]::IsNullOrEmpty($entry.Name)) {
                [System.IO.Directory]::CreateDirectory($target) | Out-Null
            } else {
                $parent = [System.IO.Path]::GetDirectoryName($target)
                if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
            }
        }
    } finally {
        $archive.Dispose()
    }
}

function Ensure-ObjectProperty([psobject]$obj, [string]$name) {
    $prop = $obj.PSObject.Properties[$name]
    if ($null -eq $prop -or $null -eq $prop.Value -or -not ($prop.Value -is [psobject])) {
        $child = [pscustomobject]@{}
        if ($null -eq $prop) {
            $obj | Add-Member -NotePropertyName $name -NotePropertyValue $child
        } else {
            $obj.$name = $child
        }
    }
    return $obj.$name
}

function Set-ObjectProperty([psobject]$obj, [string]$name, $value) {
    if ($null -eq $obj.PSObject.Properties[$name]) {
        $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value
    } else {
        $obj.$name = $value
    }
}

function New-DefaultMillenniumConfig() {
    return [pscustomobject]@{
        general = [pscustomobject]@{
            injectJavascript                         = $true
            injectCSS                                = $true
            checkForMillenniumUpdates                = $true
            checkForPluginAndThemeUpdates            = $true
            onMillenniumUpdate                       = 2
            millenniumUpdateChannel                  = "stable"
            shouldShowThemePluginUpdateNotifications = $true
            accentColor                              = "DEFAULT_ACCENT_COLOR"
        }
        misc = [pscustomobject]@{
            hasShownWelcomeModal = $false
        }
        network = [pscustomobject]@{
            proxy         = ""
            proxyUsername = ""
            proxyPassword = ""
        }
        notifications = [pscustomobject]@{
            showNotifications       = $true
            showUpdateNotifications = $true
            showPluginNotifications = $true
        }
        plugins = [pscustomobject]@{
            enabledPlugins = @()
        }
        themes = [pscustomobject]@{
            activeTheme    = "default"
            allowedStyles  = $true
            allowedScripts = $true
        }
    }
}

function Update-MillenniumConfig([string]$steamDir, [bool]$enablePlugin) {
    $configDir = Join-Path $steamDir "millennium\config"
    $configPath = Join-Path $configDir "config.json"
    [System.IO.Directory]::CreateDirectory($configDir) | Out-Null

    $cfg = $null
    if (Test-Path -LiteralPath $configPath) {
        $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $backup = Join-Path $configDir ("config.json.bak_" + $stamp)
        Copy-Item -LiteralPath $configPath -Destination $backup -Force
        Write-Ok (Msg "已备份原配置：$backup" "Backed up existing config: $backup")
        try {
            $raw = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
            $cfg = $raw | ConvertFrom-Json
        } catch {
            Write-Warn (Msg "原 config.json 解析失败，将使用默认模板重建（原文件已备份）" "Existing config.json could not be parsed; recreating from defaults (backup kept)")
            $cfg = $null
        }
    }
    if ($null -eq $cfg -or -not ($cfg -is [psobject])) {
        $cfg = New-DefaultMillenniumConfig
    }

    $general = Ensure-ObjectProperty $cfg "general"
    Set-ObjectProperty $general "injectCSS" $true
    Set-ObjectProperty $general "injectJavascript" $true

    $themes = Ensure-ObjectProperty $cfg "themes"
    Set-ObjectProperty $themes "activeTheme" "lumina"
    Set-ObjectProperty $themes "allowedStyles" $true
    Set-ObjectProperty $themes "allowedScripts" $true

    if ($enablePlugin) {
        $plugins = Ensure-ObjectProperty $cfg "plugins"
        $list = New-Object System.Collections.Generic.List[string]
        $existingProp = $plugins.PSObject.Properties["enabledPlugins"]
        if ($null -ne $existingProp -and $null -ne $existingProp.Value) {
            foreach ($item in @($existingProp.Value)) {
                $s = [string]$item
                if (-not [string]::IsNullOrWhiteSpace($s) -and -not $list.Contains($s)) {
                    $list.Add($s)
                }
            }
        }
        if (-not $list.Contains("lumina-extended")) {
            $list.Add("lumina-extended")
        }
        [string[]]$arr = $list.ToArray()
        Set-ObjectProperty $plugins "enabledPlugins" $arr
    }

    $json = $cfg | ConvertTo-Json -Depth 20
    # BOM-free UTF-8 (Millennium's C++ nlohmann::json rejects UTF-8 BOM)
    [System.IO.File]::WriteAllText($configPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
    $zhDone = if ($enablePlugin) { "已启用主题 lumina 与插件 lumina-extended" } else { "已启用主题 lumina" }
    $enDone = if ($enablePlugin) { "Enabled theme lumina and plugin lumina-extended" } else { "Enabled theme lumina" }
    Write-Ok (Msg $zhDone $enDone)
}

function Copy-CleanDir([string]$src, [string]$dst) {
    if (Test-Path -LiteralPath $dst) {
        Remove-Item -LiteralPath $dst -Recurse -Force
    }
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($dst)) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
}

# ---- Main ----

Write-Host "========================================" -ForegroundColor Cyan
Write-Host (Msg "  Lumina Steam 主题一键安装 / 更新脚本" "  Lumina Steam Theme Installer / Updater") -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan

$totalSteps = 6
$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("lumina-install-" + [Guid]::NewGuid().ToString("N"))
$script:ShouldPause = $Pause.IsPresent -or ($env:LUMINA_PAUSE -eq "1")
$exitCode = 0
$elevatedChildStarted = $false

# Auto-detect sibling lumina/ folder when launched from an extracted release archive
if ([string]::IsNullOrWhiteSpace($LocalDir) -and [string]::IsNullOrWhiteSpace($LocalZip) -and -not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
    $here = [System.IO.Path]::GetDirectoryName($PSCommandPath)
    if ($here -and (Test-Path -LiteralPath (Join-Path $here "lumina\skin.json"))) {
        $LocalDir = $here
    }
}

try {
    # Step 1: Locate Steam & check write access + installed state
    Write-Step 1 $totalSteps (Msg "检测 Steam 目录与当前安装状态..." "Detecting Steam path and installed versions...")
    $steamDir = Resolve-SteamPath $SteamPath
    Write-Ok (Msg "Steam 目录：$steamDir" "Steam directory: $steamDir")
    if (-not (Test-Writable $steamDir)) {
        if (-not (Test-IsAdmin)) {
            if (Invoke-SelfElevate $steamDir) {
                $elevatedChildStarted = $true
                return
            }
        }
        throw (Msg "当前权限无法写入 $steamDir，请右键以管理员身份运行后重试。" "No write permission for $steamDir. Please run as Administrator and retry.")
    }

    $installed = Get-InstalledState $steamDir
    if ($installed.MillenniumInstalled) {
        $mvText = if ($installed.MillenniumVersion) { $installed.MillenniumVersion } else { Msg "未知版本" "unknown version" }
        Write-Info (Msg "已安装 Millennium：$mvText" "Installed Millennium: $mvText")
    } else {
        Write-Info (Msg "未检测到 Millennium" "Millennium not installed")
    }
    if ($installed.LuminaInstalled) {
        $lvText = if ($installed.LuminaVersion) { $installed.LuminaVersion } else { Msg "未知版本" "unknown version" }
        $plText = if ($installed.PluginInstalled) { Msg "已装配套插件" "plugin installed" } else { Msg "未装配套插件" "plugin not installed" }
        Write-Info (Msg "已安装 Lumina：$lvText（$plText）" "Installed Lumina: $lvText ($plText)")
    } else {
        Write-Info (Msg "未检测到 Lumina 主题" "Lumina theme not installed")
    }

    # Step 2: Check GitHub connectivity (direct -> local proxy -> mirror) BEFORE touching Steam
    $hasLocalLumina = (-not [string]::IsNullOrWhiteSpace($LocalZip)) -or (-not [string]::IsNullOrWhiteSpace($LocalDir))
    $needOnline = (-not $SkipMillennium) -or (-not $hasLocalLumina)
    Write-Step 2 $totalSteps (Msg "检测网络连接与版本更新..." "Checking network connectivity and latest versions...")
    if ($needOnline) {
        Initialize-Network $installed.MillenniumProxy
    } else {
        Write-Info (Msg "离线模式（使用本地主题包且跳过 Millennium）" "Offline mode (local theme package + -SkipMillennium)")
    }

    # Decide Millennium action
    $needMillennium = $false
    $milRel = $null
    if ($SkipMillennium) {
        Write-Warn (Msg "已跳过 Millennium 检查（-SkipMillennium）" "Skipped Millennium check (-SkipMillennium)")
    } else {
        $milRel = Get-GitHubRelease "SteamClientHomebrew/Millennium" "millennium-*-windows-x86_64.zip" "millennium-{tag}-windows-x86_64.zip"
        if ($Force -or -not $installed.MillenniumInstalled) {
            $needMillennium = $true
            Write-Info (Msg "将安装 Millennium $($milRel.Tag)" "Will install Millennium $($milRel.Tag)")
        } elseif ([string]::IsNullOrWhiteSpace($installed.MillenniumVersion)) {
            $needMillennium = $true
            Write-Info (Msg "无法识别本地 Millennium 版本，将更新至 $($milRel.Tag)" "Local Millennium version unknown; will update to $($milRel.Tag)")
        } else {
            $cmpMil = Compare-SemVer $installed.MillenniumVersion $milRel.Tag
            if ($cmpMil -lt 0) {
                $needMillennium = $true
                Write-Info (Msg "发现 Millennium 更新：$($installed.MillenniumVersion) -> $($milRel.Tag)" "Millennium update available: $($installed.MillenniumVersion) -> $($milRel.Tag)")
            } else {
                Write-Ok (Msg "Millennium 已是最新（本地 $($installed.MillenniumVersion)，线上 $($milRel.Tag)），跳过下载" "Millennium is up to date (local $($installed.MillenniumVersion), latest $($milRel.Tag)); skipping")
            }
        }
    }

    # Decide Lumina + plugin action
    $wantPlugin = -not $NoPlugin
    $needLumina = $false
    $lumRel = $null
    if (-not [string]::IsNullOrWhiteSpace($LocalDir)) {
        $localSkin = Join-Path $LocalDir "lumina\skin.json"
        if (-not (Test-Path -LiteralPath $localSkin)) {
            throw (Msg "本地目录缺少 lumina\skin.json：$LocalDir" "Local directory missing lumina\skin.json: $LocalDir")
        }
        $localVer = ""
        try {
            $localVer = [string](([System.IO.File]::ReadAllText($localSkin, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).version)
        } catch {}
        $missingPlugin = $wantPlugin -and (-not $installed.PluginInstalled) -and (Test-Path -LiteralPath (Join-Path $LocalDir "lumina-extended"))
        if ($Force -or -not $installed.LuminaInstalled -or $missingPlugin -or [string]::IsNullOrWhiteSpace($localVer) -or (Compare-SemVer $installed.LuminaVersion $localVer) -lt 0) {
            $needLumina = $true
            Write-Info (Msg "将从本地目录安装 Lumina v$localVer" "Will install Lumina v$localVer from local directory")
        } else {
            Write-Ok (Msg "Lumina 已安装（本地 v$($installed.LuminaVersion) >= 包内 v$localVer），跳过覆盖" "Lumina already installed (v$($installed.LuminaVersion) >= v$localVer); skipping")
        }
    } elseif (-not [string]::IsNullOrWhiteSpace($LocalZip)) {
        if (-not (Test-Path -LiteralPath $LocalZip)) {
            throw (Msg "指定的本地压缩包不存在：$LocalZip" "Local zip not found: $LocalZip")
        }
        $needLumina = $true
        Write-Info (Msg "将使用本地安装包：$LocalZip" "Will install from local package: $LocalZip")
    } else {
        $lumRel = Get-GitHubRelease "Fisnetia/Lumina-Steam-Theme" "Lumina-*.zip" "Lumina-{ver}.zip"
        $missingPlugin = $wantPlugin -and (-not $installed.PluginInstalled)
        if ($Force -or -not $installed.LuminaInstalled -or $missingPlugin) {
            $needLumina = $true
            $reason = if (-not $installed.LuminaInstalled) {
                Msg "将安装 Lumina $($lumRel.Tag)" "Will install Lumina $($lumRel.Tag)"
            } elseif ($missingPlugin) {
                Msg "缺少配套插件 lumina-extended，将补装 Lumina $($lumRel.Tag)" "Missing lumina-extended plugin; will install Lumina $($lumRel.Tag)"
            } else {
                Msg "将强制重装 Lumina $($lumRel.Tag)" "Force reinstalling Lumina $($lumRel.Tag)"
            }
            Write-Info $reason
        } elseif ([string]::IsNullOrWhiteSpace($installed.LuminaVersion)) {
            $needLumina = $true
            Write-Info (Msg "无法识别本地 Lumina 版本，将更新至 $($lumRel.Tag)" "Local Lumina version unknown; will update to $($lumRel.Tag)")
        } else {
            $cmpLum = Compare-SemVer $installed.LuminaVersion $lumRel.Tag
            if ($cmpLum -lt 0) {
                $needLumina = $true
                Write-Info (Msg "发现 Lumina 更新：v$($installed.LuminaVersion) -> $($lumRel.Tag)" "Lumina update available: v$($installed.LuminaVersion) -> $($lumRel.Tag)")
            } else {
                Write-Ok (Msg "Lumina 已是最新（本地 v$($installed.LuminaVersion)，线上 $($lumRel.Tag)），跳过下载" "Lumina is up to date (local v$($installed.LuminaVersion), latest $($lumRel.Tag)); skipping")
            }
        }
    }

    $needConfigUpdate = (-not $installed.ThemeActive) -or ($wantPlugin -and (-not $installed.PluginEnabled))

    if (-not $needMillennium -and -not $needLumina -and -not $needConfigUpdate) {
        Write-Host ""
        Write-Ok (Msg "Millennium、Lumina 及配置均已是最新状态，无需关闭或重启 Steam！（如需强制重装可加 -Force）" "Millennium, Lumina, and configuration are already up to date. No Steam restart needed! (Use -Force to reinstall)")
        return
    }

    # Step 3: Pre-download & verify needed packages WHILE Steam is still running
    Write-Step 3 $totalSteps (Msg "下载并校验所需安装包..." "Downloading and verifying packages...")
    [System.IO.Directory]::CreateDirectory($tmpRoot) | Out-Null

    $milZip = ""
    if ($needMillennium) {
        Write-Info (Msg "正在下载 Millennium $($milRel.Tag)..." "Downloading Millennium $($milRel.Tag)...")
        $milZip = Join-Path $tmpRoot $milRel.AssetName
        Download-File $milRel.Url $milZip

        $expectedSha = $milRel.Sha256
        if ([string]::IsNullOrWhiteSpace($expectedSha) -and -not [string]::IsNullOrWhiteSpace($milRel.ShaUrl)) {
            try {
                $shaFile = Join-Path $tmpRoot "millennium.sha256"
                Download-File $milRel.ShaUrl $shaFile
                $shaText = ([System.IO.File]::ReadAllText($shaFile)).Trim()
                if ($shaText -match "([0-9a-fA-F]{64})") {
                    $expectedSha = $Matches[1].ToLowerInvariant()
                }
            } catch {}
        }
        if (-not [string]::IsNullOrWhiteSpace($expectedSha)) {
            $actualSha = (Get-FileHash -LiteralPath $milZip -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualSha -ne $expectedSha) {
                throw (Msg "Millennium 安装包 SHA-256 校验失败，已中止安装（Steam 未受影响）。" "Millennium package SHA-256 verification failed; aborting (Steam was not closed).")
            }
            Write-Ok (Msg "Millennium SHA-256 校验通过" "Millennium SHA-256 verified")
        }
    }

    $luminaZip = ""
    $luminaLabel = ""
    if ($needLumina) {
        if (-not [string]::IsNullOrWhiteSpace($LocalDir)) {
            $luminaLabel = Msg "本地包" "local"
            Write-Ok (Msg "就绪：$LocalDir" "Ready: $LocalDir")
        } elseif (-not [string]::IsNullOrWhiteSpace($LocalZip)) {
            $luminaZip = (Resolve-Path -LiteralPath $LocalZip).Path
            $luminaLabel = [System.IO.Path]::GetFileName($luminaZip)
            Write-Ok (Msg "就绪：$luminaZip" "Ready: $luminaZip")
        } else {
            $luminaLabel = $lumRel.Tag
            Write-Info (Msg "正在下载 Lumina $luminaLabel..." "Downloading Lumina $luminaLabel...")
            $luminaZip = Join-Path $tmpRoot $lumRel.AssetName
            Download-File $lumRel.Url $luminaZip
            Write-Ok (Msg "Lumina $luminaLabel 下载完成" "Lumina $luminaLabel downloaded")
        }
    }

    if (-not $needMillennium -and -not $needLumina) {
        Write-Info (Msg "无需下载安装包，仅需更新配置" "No downloads needed; updating config only")
    }

    # Step 4: Shut down Steam cleanly now that all downloads are verified
    Write-Step 4 $totalSteps (Msg "关闭运行中的 Steam..." "Closing running Steam...")
    Stop-SteamGracefully $steamDir

    # Step 5: Extract packages & update Millennium config.json
    Write-Step 5 $totalSteps (Msg "安装文件并写入配置..." "Installing files and updating config...")
    if ($needMillennium) {
        Extract-ZipSafe $milZip $steamDir
        Write-Ok (Msg "Millennium $($milRel.Tag) 已安装" "Millennium $($milRel.Tag) installed")
    }

    $installPlugin = $wantPlugin
    if ($needLumina) {
        $pkgRoot = ""
        if (-not [string]::IsNullOrWhiteSpace($LocalDir)) {
            $pkgRoot = (Resolve-Path -LiteralPath $LocalDir).Path
        } else {
            $pkgRoot = Join-Path $tmpRoot "lumina-pkg"
            Extract-ZipSafe $luminaZip $pkgRoot
        }

        $themeSrc = Join-Path $pkgRoot "lumina"
        if (-not (Test-Path -LiteralPath (Join-Path $themeSrc "skin.json"))) {
            throw (Msg "安装包内缺少 lumina/skin.json" "Package is missing lumina/skin.json")
        }
        $themeDst = Join-Path $steamDir "millennium\themes\lumina"
        Copy-CleanDir $themeSrc $themeDst
        Write-Ok (Msg "Lumina $luminaLabel 主题已安装" "Lumina $luminaLabel theme installed")

        if ($wantPlugin) {
            $pluginSrc = Join-Path $pkgRoot "lumina-extended"
            if (Test-Path -LiteralPath $pluginSrc) {
                $pluginDst = Join-Path $steamDir "millennium\plugins\lumina-extended"
                Copy-CleanDir $pluginSrc $pluginDst
                Write-Ok (Msg "配套插件 lumina-extended 已安装" "Companion plugin lumina-extended installed")
            } else {
                Write-Warn (Msg "安装包内未包含 lumina-extended，已跳过插件安装" "lumina-extended not found in package; skipping plugin")
                $installPlugin = $false
            }
        } else {
            Write-Warn (Msg "已跳过 lumina-extended 插件安装（-NoPlugin）" "Skipped lumina-extended plugin (-NoPlugin)")
        }
    }

    if ($needConfigUpdate -or $needMillennium -or $needLumina) {
        Update-MillenniumConfig $steamDir $installPlugin
    }

    # Step 6: Restart Steam
    Write-Step 6 $totalSteps (Msg "重新启动 Steam..." "Restarting Steam...")
    if ($NoRestart) {
        Write-Warn (Msg "已跳过重启 Steam（-NoRestart），请手动启动 Steam。" "Skipped Steam restart (-NoRestart). Please launch Steam manually.")
    } else {
        $steamExe = Join-Path $steamDir "steam.exe"
        if ($SteamArgs.Count -gt 0) {
            Start-Process -FilePath $steamExe -ArgumentList $SteamArgs -WorkingDirectory $steamDir
        } else {
            Start-Process -FilePath $steamExe -WorkingDirectory $steamDir
        }
        Write-Ok (Msg "Steam 已启动，全部完成！" "Steam launched. All done!")
    }
} catch {
    Write-Host ""
    Write-Err $_.Exception.Message
    $exitCode = 1
} finally {
    if (Test-Path -LiteralPath $tmpRoot) {
        Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not $elevatedChildStarted -and $script:ShouldPause) {
        Wait-BeforeExit
    }
}
if ($exitCode -ne 0) { exit $exitCode }
