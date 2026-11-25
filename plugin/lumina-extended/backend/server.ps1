<#
  lumina-extended file server, started hidden by main.lua.
  GET http://localhost:<port>/<token>/<root index>/<path>
  Token required; paths must stay inside the roots; Range supported (open
  ranges answered in 8 MB chunks); CORS open; exits with its parent process.
#>
param(
    [int]$Port,
    [string]$Token,
    [string]$Roots,
    [int]$ParentPid,
    [string]$PortFile
)
$ErrorActionPreference = 'Stop'

$rootList = @($Roots -split '\|' | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') + '\' })

$listener = $null
for ($p = $Port; $p -lt $Port + 50; $p++) {
    try {
        $l = [System.Net.HttpListener]::new()
        $l.Prefixes.Add("http://localhost:$p/")
        $l.Start()
        $listener = $l
        break
    } catch { }
}
if (-not $listener) { exit 1 }
Set-Content -LiteralPath $PortFile -Value $p -Encoding ascii

$handler = {
    param($ctx, $token, $rootList)
    $req = $ctx.Request
    $res = $ctx.Response
    $mime = @{
        '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
        '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
        '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
        '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'
        '.webp' = 'image/webp'; '.svg' = 'image/svg+xml'; '.bmp' = 'image/bmp'; '.ico' = 'image/x-icon'
        '.mp4' = 'video/mp4'; '.webm' = 'video/webm'; '.m4v' = 'video/mp4'; '.mov' = 'video/quicktime'
        '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'; '.m4a' = 'audio/mp4'
        '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'; '.otf' = 'font/otf'
        '.wasm' = 'application/wasm'; '.txt' = 'text/plain; charset=utf-8'
    }
    $CHUNK = 32MB
    try {
        $res.AddHeader('Access-Control-Allow-Origin', '*')
        $res.AddHeader('Access-Control-Allow-Headers', 'Range')
        $res.AddHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges')
        if ($req.HttpMethod -eq 'OPTIONS') { $res.StatusCode = 204; return }
        if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') { $res.StatusCode = 405; return }

        # /<token>/<root>/<path...>
        $parts = $req.Url.AbsolutePath.TrimStart('/').Split('/')
        if ($parts.Length -lt 3 -or $parts[0] -ne $token) { $res.StatusCode = 404; return }
        $ri = 0
        if (-not [int]::TryParse($parts[1], [ref]$ri) -or $ri -lt 0 -or $ri -ge $rootList.Count) { $res.StatusCode = 404; return }
        $root = $rootList[$ri]
        $rel = (($parts[2..($parts.Length - 1)] | ForEach-Object { [Uri]::UnescapeDataString($_) }) -join '\')
        $full = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $rel))
        if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { $res.StatusCode = 403; return }
        if (-not [IO.File]::Exists($full)) { $res.StatusCode = 404; return }

        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.AddHeader('Accept-Ranges', 'bytes')
        $res.AddHeader('Cache-Control', 'private, max-age=3600')

        # Web wallpapers run inside a blob: iframe (different origin from this
        # server), so local images loaded via new Image() without crossOrigin
        # taint 2D/WebGL canvases. Set crossOrigin="anonymous" only for URLs on
        # this local server's origin (external URLs stay untouched).
        if (($ext -eq '.html' -or $ext -eq '.htm') -and -not $req.Headers['Range']) {
            $fi = [IO.FileInfo]::new($full)
            if ($fi.Length -le 2MB) {
                $html = [IO.File]::ReadAllText($full, [Text.Encoding]::UTF8)
                $shim = '<script data-lm-cors="1">(function(){var o="";try{o=new URL(document.baseURI).origin;}catch(e){}if(!o||o==="null")return;function loc(u){try{return new URL(String(u),document.baseURI).origin===o;}catch(e){return false;}}function wrap(P){if(!P)return;var d=Object.getOwnPropertyDescriptor(P,"src");if(d&&d.set)Object.defineProperty(P,"src",{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){if(!this.crossOrigin&&loc(v))this.crossOrigin="anonymous";d.set.call(this,v);}});}wrap(HTMLImageElement.prototype);wrap(HTMLMediaElement.prototype);var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(k,v){if(String(k).toLowerCase()==="src"&&(this instanceof HTMLImageElement||this instanceof HTMLMediaElement)&&!this.crossOrigin&&loc(v))this.crossOrigin="anonymous";return sa.call(this,k,v);};})();</script>'
                if ($html -match '(?i)<head(?:\s[^>]*)?>') {
                    $html = [regex]::Replace($html, '(?i)(<head(?:\s[^>]*)?>)', "`$1$shim", 1)
                } else {
                    $html = $shim + $html
                }
                $bytes = [Text.Encoding]::UTF8.GetBytes($html)
                $res.ContentLength64 = $bytes.Length
                if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
                return
            }
        }

        $fs = [IO.File]::Open($full, 'Open', 'Read', 'ReadWrite')
        try {
            $size = $fs.Length
            $start = 0L; $end = $size - 1
            $range = $req.Headers['Range']
            if ($range -and $range -match '^bytes=(\d*)-(\d*)$') {
                if ($Matches[1] -eq '' -and $Matches[2] -ne '') {          # bytes=-N (suffix)
                    $start = [Math]::Max(0L, $size - [int64]$Matches[2])
                } else {
                    $start = [int64]$Matches[1]
                    if ($Matches[2] -ne '') { $end = [Math]::Min($size - 1, [int64]$Matches[2]) }
                    else { $end = [Math]::Min($size - 1, $start + $CHUNK - 1) }   # open-ended: one chunk
                }
                if ($start -ge $size -or $start -gt $end) {
                    $res.StatusCode = 416
                    $res.AddHeader('Content-Range', "bytes */$size")
                    return
                }
                $res.StatusCode = 206
                $res.AddHeader('Content-Range', "bytes $start-$end/$size")
            }
            $len = $end - $start + 1
            $res.ContentLength64 = $len
            if ($req.HttpMethod -eq 'HEAD') { return }
            [void]$fs.Seek($start, 'Begin')
            $buf = New-Object byte[] 1048576
            $out = $res.OutputStream
            while ($len -gt 0) {
                $n = $fs.Read($buf, 0, [int][Math]::Min($buf.Length, $len))
                if ($n -le 0) { break }
                $out.Write($buf, 0, $n)
                $len -= $n
            }
        } finally { $fs.Dispose() }
    } catch {
        try { $res.StatusCode = 500 } catch { }
    } finally {
        try { $res.Close() } catch { }
    }
}

$pool = [RunspaceFactory]::CreateRunspacePool(1, 6)
$pool.Open()
$jobs = New-Object System.Collections.ArrayList

$parentProc = $null
try { $parentProc = [System.Diagnostics.Process]::GetProcessById($ParentPid) } catch { exit 0 }

try {
    while ($true) {
        $async = $listener.BeginGetContext($null, $null)
        while (-not $async.AsyncWaitHandle.WaitOne(1000)) {
            if ($parentProc.HasExited) { exit 0 }
        }
        $ctx = $listener.EndGetContext($async)
        $ps = [PowerShell]::Create()
        $ps.RunspacePool = $pool
        [void]$ps.AddScript($handler).AddArgument($ctx).AddArgument($Token).AddArgument($rootList)
        [void]$jobs.Add(@{ ps = $ps; handle = $ps.BeginInvoke() })
        # tidy finished workers
        for ($i = $jobs.Count - 1; $i -ge 0; $i--) {
            if ($jobs[$i].handle.IsCompleted) {
                try { $jobs[$i].ps.EndInvoke($jobs[$i].handle) } catch { }
                $jobs[$i].ps.Dispose()
                $jobs.RemoveAt($i)
            }
        }
    }
} finally {
    try { $listener.Stop() } catch { }
    try { Remove-Item -LiteralPath $PortFile -ErrorAction SilentlyContinue } catch { }
}
