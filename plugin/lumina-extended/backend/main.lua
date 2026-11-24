--[[
  lumina-extended: companion plugin for the Lumina theme.
  - Lists the Wallpaper Engine library and serves its files through server.ps1
  - Shares a backdrop still for Store / Community web pages
  - Applies Windows DWM desktop acrylic to Steam windows in Acrylic backdrop mode

  Status() -> { base = "http://localhost:<port>/<token>/" } | { starting = true } | { error }
  List()   -> [ { id = "<root>/<folder>", title, type, file, preview } ]
  SetStill({ data = <base64 JPEG> }) -> { ok }
  PatchAcrylic({ enabled = <bool?> }) -> { ok, enabled, patched }
  AcrylicState() -> { enabled }: the last state PatchAcrylic was asked for
]]

local logger = require("logger")
local millennium = require("millennium")
local json = require("json")
local ffi = require("ffi")

ffi.cdef [[
typedef struct {
    uint32_t cb; void *lpReserved; void *lpDesktop; void *lpTitle;
    uint32_t dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    uint16_t wShowWindow, cbReserved2; void *lpReserved2;
    void *hStdInput, *hStdOutput, *hStdError;
} LMWE_STARTUPINFOW;
typedef struct { void *hProcess, *hThread; uint32_t dwProcessId, dwThreadId; } LMWE_PROCESS_INFORMATION;
typedef struct {
    uint32_t dwSize;
    uint32_t cntUsage;
    uint32_t th32ProcessID;
    uintptr_t th32DefaultHeapID;
    uint32_t th32ModuleID;
    uint32_t cntThreads;
    uint32_t th32ParentProcessID;
    int32_t pcPriClassBase;
    uint32_t dwFlags;
    uint16_t szExeFile[260];
} LMWE_PROCESSENTRY32W;
typedef struct {
    int32_t nAccentState;
    int32_t nFlags;
    uint32_t nColor;
    int32_t nAnimationId;
} LMWE_ACCENTPOLICY;
typedef struct {
    int32_t nAttribute;
    void *pData;
    size_t ulDataSize;
} LMWE_WINDOWCOMPOSITIONATTRIBDATA;

typedef struct {
    int32_t cxLeftWidth;
    int32_t cxRightWidth;
    int32_t cyTopHeight;
    int32_t cyBottomHeight;
} LMWE_MARGINS;

int CreateProcessW(const uint16_t *app, uint16_t *cmd, void *pa, void *ta, int inherit, uint32_t flags,
                   void *env, const uint16_t *cwd, LMWE_STARTUPINFOW *si, LMWE_PROCESS_INFORMATION *pi);
int MultiByteToWideChar(uint32_t cp, uint32_t flags, const char *s, int n, uint16_t *w, int wn);
int WideCharToMultiByte(uint32_t cp, uint32_t flags, const uint16_t *w, int wn, char *s, int sn,
                        const char *def, int *used);
int TerminateProcess(void *h, uint32_t code);
int CloseHandle(void *h);
uint32_t GetCurrentProcessId(void);
int CreateDirectoryW(const uint16_t *path, void *sa);
int MoveFileExW(const uint16_t *src, const uint16_t *dst, uint32_t flags);
void *CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid);
int Process32FirstW(void *snap, LMWE_PROCESSENTRY32W *entry);
int Process32NextW(void *snap, LMWE_PROCESSENTRY32W *entry);
void *FindWindowExW(void *parent, void *after, const uint16_t *cls, const uint16_t *title);
uint32_t GetWindowThreadProcessId(void *hwnd, uint32_t *pid);
int GetWindowTextW(void *hwnd, uint16_t *buf, int max);
int GetClassNameW(void *hwnd, uint16_t *buf, int max);
int IsWindowVisible(void *hwnd);
int32_t GetWindowLongW(void *hwnd, int index);
int SetWindowCompositionAttribute(void *hwnd, LMWE_WINDOWCOMPOSITIONATTRIBDATA *data);
int32_t DwmSetWindowAttribute(void *hwnd, uint32_t attr, const void *val, uint32_t size);
int32_t DwmExtendFrameIntoClientArea(void *hwnd, const LMWE_MARGINS *margins);
long BCryptGenRandom(void *alg, uint8_t *buf, uint32_t n, uint32_t flags);
]]
local kernel32 = ffi.load("kernel32")
local bcrypt = ffi.load("bcrypt")
local ok_u32, user32 = pcall(ffi.load, "user32")
local ok_dwm, dwmapi = pcall(ffi.load, "dwmapi")
if not ok_u32 then user32 = nil end
if not ok_dwm then dwmapi = nil end
local has_swca = user32 ~= nil and pcall(function() return user32.SetWindowCompositionAttribute end)
local has_dwma = dwmapi ~= nil and pcall(function() return dwmapi.DwmSetWindowAttribute end)
local has_dwm_ext = dwmapi ~= nil and pcall(function() return dwmapi.DwmExtendFrameIntoClientArea end)

local CREATE_NO_WINDOW = 0x08000000
local MOVEFILE_REPLACE_EXISTING = 0x1
local TH32CS_SNAPPROCESS = 0x00000002
local INVALID_HANDLE = ffi.cast("void*", ffi.cast("intptr_t", -1))
local WCA_ACCENT_POLICY = 19
local ACCENT_DISABLED = 0
local ACCENT_ENABLE_BLURBEHIND = 3
local ACCENT_ENABLE_ACRYLICBLURBEHIND = 4
local ACCENT_FLAG_GRADIENT = 0x02   -- acrylic: use nColor as the tint
local DWMWA_USE_IMMERSIVE_DARK_MODE = 20
local DWMWA_WINDOW_CORNER_PREFERENCE = 33
local DWMWA_SYSTEMBACKDROP_TYPE = 38
local DWMWCP_ROUND = 2
local DWMSBT_NONE = 1
local GWL_STYLE = -16
local GWL_EXSTYLE = -20
local WS_THICKFRAME = 0x00040000
local WS_CAPTION = 0x00C00000
local WS_EX_TOOLWINDOW = 0x00000080
local WS_EX_NOACTIVATE = 0x08000000
local DEFAULT_ACRYLIC_COLOR = 0x55221712   -- ABGR: ~33% #121722 (non-zero alpha required on Win11)
local bit = require("bit")
local WALLPAPER_ENGINE = "431960"

-- helpers

local function wide(s)
    local n = kernel32.MultiByteToWideChar(65001, 0, s, -1, nil, 0)
    local buf = ffi.new("uint16_t[?]", n)
    kernel32.MultiByteToWideChar(65001, 0, s, -1, buf, n)
    return buf
end

local function random_hex(bytes)
    local buf = ffi.new("uint8_t[?]", bytes)
    if bcrypt.BCryptGenRandom(nil, buf, bytes, 2) ~= 0 then   -- BCRYPT_USE_SYSTEM_PREFERRED_RNG
        error("BCryptGenRandom failed")
    end
    local out = {}
    for i = 0, bytes - 1 do out[#out + 1] = string.format("%02x", buf[i]) end
    return table.concat(out)
end

local function read_file(path)
    local f = io.open(path, "rb")
    if not f then return nil end
    local data = f:read("*a")
    f:close()
    return data
end

local function is_dir(path)
    local ok, entries = pcall(function() return require("fs").list(path) end)
    return ok and entries ~= nil
end

local function plugin_dir()
    local src = debug.getinfo(1, "S").source:gsub("^@", "")
    return (src:gsub("[/\\][^/\\]+$", ""))   -- .../lumina-extended/backend
end

-- library roots: each Steam library's workshop/431960, plus WE's myprojects

local roots = {}

local function find_roots()
    roots = {}
    local steam = millennium.steam_path()
    local libraries = { steam }
    local vdf = read_file(steam .. "\\steamapps\\libraryfolders.vdf") or ""
    for path in vdf:gmatch('"path"%s+"([^"]+)"') do
        libraries[#libraries + 1] = (path:gsub("\\\\", "\\"))
    end
    local seen = {}
    for _, lib in ipairs(libraries) do
        local key = lib:lower():gsub("[/\\]+$", "")
        if not seen[key] then
            seen[key] = true
            for _, dir in ipairs({
                lib .. "\\steamapps\\workshop\\content\\" .. WALLPAPER_ENGINE,
                lib .. "\\steamapps\\common\\wallpaper_engine\\projects\\myprojects",
            }) do
                if is_dir(dir) then roots[#roots + 1] = dir end
            end
        end
    end
    logger:info("[lumina-extended] library roots: " .. table.concat(roots, " | "))
end

local B64 = {}
for i = 1, 64 do B64[("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"):byte(i)] = i - 1 end

local function unbase64(s)
    local out, n, acc, bits = {}, 0, 0, 0
    for i = 1, #s do
        local v = B64[s:byte(i)]
        if v then
            acc = bit.bor(bit.lshift(acc, 6), v)
            bits = bits + 6
            if bits >= 8 then
                bits = bits - 8
                n = n + 1
                out[n] = string.char(bit.band(bit.rshift(acc, bits), 0xFF))
                acc = bit.band(acc, bit.lshift(1, bits) - 1)
            end
        end
    end
    return table.concat(out)
end

-- file server; its last root is the share folder (the backdrop still)

local SHARE = (os.getenv("TEMP") or "C:\\Windows\\Temp") .. "\\lumina-extended-share"
local still = { version = nil }
local server = { process = nil, port_file = nil, token = nil, base = nil }

local function start_server()
    server.token = random_hex(16)
    kernel32.CreateDirectoryW(wide(SHARE), nil)
    server.port_file = (os.getenv("TEMP") or "C:\\Windows\\Temp") .. "\\lumina-extended-" .. server.token .. ".port"
    local script = plugin_dir() .. "\\server.ps1"
    local port = 47000 + (tonumber(server.token:sub(1, 4), 16) % 2000)
    local all_roots = {}
    for _, r in ipairs(roots) do all_roots[#all_roots + 1] = r end
    all_roots[#all_roots + 1] = SHARE
    local cmd = string.format(
        'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%s" ' ..
        '-Port %d -Token %s -Roots "%s" -ParentPid %d -PortFile "%s"',
        script, port, server.token, table.concat(all_roots, "|"), kernel32.GetCurrentProcessId(), server.port_file)
    local si = ffi.new("LMWE_STARTUPINFOW")
    si.cb = ffi.sizeof(si)
    local pi = ffi.new("LMWE_PROCESS_INFORMATION")
    if kernel32.CreateProcessW(nil, wide(cmd), nil, nil, 0, CREATE_NO_WINDOW, nil, nil, si, pi) == 0 then
        logger:error("[lumina-extended] could not start the file server")
        return
    end
    kernel32.CloseHandle(pi.hThread)
    server.process = pi.hProcess
    logger:info("[lumina-extended] file server starting (pid " .. tostring(pi.dwProcessId) .. ")")
end

local function stop_server()
    if server.process ~= nil then
        kernel32.TerminateProcess(server.process, 0)
        kernel32.CloseHandle(server.process)
        server.process = nil
    end
    if server.port_file then os.remove(server.port_file) end
end

-- methods

function Status()
    if not server.base and server.port_file then
        local port = read_file(server.port_file)
        port = port and tonumber(port:match("%d+"))
        if port then server.base = string.format("http://localhost:%d/%s/", port, server.token) end
    end
    if server.base then
        local out = { base = server.base, hasLibrary = #roots > 0 }
        if still.version then out.still = string.format("%s%d/still.jpg?v=%s", server.base, #roots, still.version) end
        return json.encode(out)
    end
    if server.process == nil then
        return json.encode({ error = "file server failed to start" })
    end
    return json.encode({ starting = true })
end

function SetStill(args)
    local data = type(args) == "table" and args.data or args
    if type(data) ~= "string" or #data == 0 or #data > 8 * 1024 * 1024 then
        return json.encode({ error = "no image" })
    end
    local tmp = SHARE .. "\\still.tmp"
    local dst = SHARE .. "\\still.jpg"
    local f = io.open(tmp, "wb")
    if not f then return json.encode({ error = "cannot write" }) end
    f:write(unbase64(data))
    f:close()
    if kernel32.MoveFileExW(wide(tmp), wide(dst), MOVEFILE_REPLACE_EXISTING) == 0 then
        os.remove(tmp)
        return json.encode({ error = "cannot write" })
    end
    still.version = tostring(os.time()) .. random_hex(2)
    return json.encode({ ok = true })
end

function List()
    local fs = require("fs")
    local items = {}
    for ri, root in ipairs(roots) do
        local entries = fs.list(root) or {}
        for _, e in ipairs(entries) do
            if e.is_directory then
                local raw = read_file(e.path .. "\\project.json")
                local ok, p = pcall(json.decode, raw or "")
                if ok and type(p) == "table" then
                    items[#items + 1] = {
                        id = tostring(ri - 1) .. "/" .. e.name,
                        title = type(p.title) == "string" and p.title or e.name,
                        type = type(p.type) == "string" and p.type:lower() or "",
                        file = type(p.file) == "string" and p.file or "",
                        preview = type(p.preview) == "string" and p.preview or "",
                    }
                end
            end
        end
    end
    return json.encode(items)
end

-- Windows DWM desktop acrylic (64-bit safe FFI, callback-free window walk)

local proc_entry = ffi.new("LMWE_PROCESSENTRY32W")
local name_buf = ffi.new("char[260]")
local wide_buf = ffi.new("uint16_t[260]")
local pid_buf = ffi.new("uint32_t[1]")
local accent_policy = ffi.new("LMWE_ACCENTPOLICY")
local comp_data = ffi.new("LMWE_WINDOWCOMPOSITIONATTRIBDATA")
comp_data.nAttribute = WCA_ACCENT_POLICY
comp_data.pData = ffi.cast("void*", accent_policy)
comp_data.ulDataSize = ffi.sizeof(accent_policy)
local corner_pref = ffi.new("int32_t[1]", DWMWCP_ROUND)
local dark_mode = ffi.new("int32_t[1]", 1)
local backdrop_type = ffi.new("int32_t[1]", DWMSBT_NONE)
local margins_zero = ffi.new("LMWE_MARGINS", 0, 0, 0, 0)

local acrylic_active = false
local acrylic_wanted = false   -- what the theme last asked for; read by the frontend
local acrylic_mode = ""
local patched_hwnds = {}   -- hwnd string -> "<mode>:<color>:<flags>:<v|h>" last applied

local function narrow(wstr)
    local n = kernel32.WideCharToMultiByte(65001, 0, wstr, -1, name_buf, 260, nil, nil)
    return n > 0 and ffi.string(name_buf) or ""
end

local function read_acrylic_config()
    local raw = read_file(millennium.steam_path() .. "\\millennium\\config\\config.json")
    if not raw then return false, "blur" end
    local ok, cfg = pcall(json.decode, raw)
    if not ok or type(cfg) ~= "table" then return false, "blur" end
    local themes = cfg.themes
    if type(themes) ~= "table" or themes.activeTheme ~= "lumina" then return false, "blur" end
    local conds = type(themes.conditions) == "table" and themes.conditions.lumina
    if type(conds) ~= "table" then return false, "blur" end
    local enabled = conds.Backdrop == "Acrylic"
    local mode = conds["Desktop blur"] == "Strong" and "acrylic" or "blur"
    return enabled, mode
end

-- Steam's CEF top-level windows (main, friends, chat, settings) share this class
local SDL_CLASS = wide("SDL_app")
local webhelper_pids = {}   -- pid -> true | false

local function refresh_pids()
    webhelper_pids = {}
    local snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == INVALID_HANDLE then return end
    pcall(function()
        proc_entry.dwSize = ffi.sizeof(proc_entry)
        local more = kernel32.Process32FirstW(snap, proc_entry)
        while more ~= 0 do
            if narrow(proc_entry.szExeFile):lower() == "steamwebhelper.exe" then
                webhelper_pids[tonumber(proc_entry.th32ProcessID)] = true
            end
            more = kernel32.Process32NextW(snap, proc_entry)
        end
    end)
    kernel32.CloseHandle(snap)
end

-- unknown pids trigger at most one process snapshot per walk
local function is_webhelper(pid, walk)
    local known = webhelper_pids[pid]
    if known ~= nil then return known end
    if not walk.refreshed then
        walk.refreshed = true
        refresh_pids()
    end
    known = webhelper_pids[pid] == true
    webhelper_pids[pid] = known
    return known
end

local function patch_hwnd(hwnd, enabled, mode, color, flags)
    local hkey = tostring(hwnd)
    if not enabled then
        if not patched_hwnds[hkey] then return false, 0 end
        if has_dwma then
            backdrop_type[0] = DWMSBT_NONE
            dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, backdrop_type, 4)
        end
        if has_dwm_ext then dwmapi.DwmExtendFrameIntoClientArea(hwnd, margins_zero) end
        if has_swca then
            accent_policy.nAccentState = ACCENT_DISABLED
            accent_policy.nFlags = 0
            accent_policy.nColor = 0
            accent_policy.nAnimationId = 0
            user32.SetWindowCompositionAttribute(hwnd, comp_data)
        end
        patched_hwnds[hkey] = nil
        return true, 0
    end

    -- a hidden window is patched once, then again once it is shown
    local vis = user32.IsWindowVisible(hwnd) ~= 0
    local skey = string.format("%s:%s:%s:%s", mode, tostring(color or ""), tostring(flags or ""), vis and "v" or "h")
    if patched_hwnds[hkey] == skey then
        return true, 0
    end

    if has_dwma then
        dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, dark_mode, 4)
        dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, corner_pref, 4)
        backdrop_type[0] = DWMSBT_NONE
        dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, backdrop_type, 4)
    end
    if has_dwm_ext then
        dwmapi.DwmExtendFrameIntoClientArea(hwnd, margins_zero)
    end
    if not has_swca then return false, -1 end
    accent_policy.nAccentState = mode == "blur" and ACCENT_ENABLE_BLURBEHIND or ACCENT_ENABLE_ACRYLICBLURBEHIND
    accent_policy.nFlags = flags or (mode == "blur" and 0 or ACCENT_FLAG_GRADIENT)
    accent_policy.nColor = color or (mode == "blur" and 0 or DEFAULT_ACRYLIC_COLOR)
    accent_policy.nAnimationId = 0
    local ok = user32.SetWindowCompositionAttribute(hwnd, comp_data) ~= 0
    if ok then patched_hwnds[hkey] = skey end
    return ok, ok and 0 or -1
end

local function is_app_window(hwnd)
    local style = user32.GetWindowLongW(hwnd, GWL_STYLE)
    local ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    if bit.band(ex, WS_EX_TOOLWINDOW) ~= 0 or bit.band(ex, WS_EX_NOACTIVATE) ~= 0 then
        return false
    end
    return bit.band(style, WS_THICKFRAME) ~= 0 or bit.band(style, WS_CAPTION) ~= 0
end

local function apply_acrylic(enabled, opts)
    if not user32 then return 0, nil, "user32 unavailable" end
    local walk = {}
    local mode = (opts and opts.mode) or "blur"
    local color = opts and opts.color or nil
    local flags = opts and opts.flags or nil
    local inspect = opts and opts.inspect or false
    local info = inspect and {} or nil
    local patched = 0
    local hwnd = user32.FindWindowExW(nil, nil, SDL_CLASS, nil)
    local guard = 0
    while hwnd ~= nil and guard < 4096 do
        guard = guard + 1
        user32.GetWindowThreadProcessId(hwnd, pid_buf)
        if is_webhelper(tonumber(pid_buf[0]), walk) and (not enabled or is_app_window(hwnd)) then
            local ok, hr = patch_hwnd(hwnd, enabled, mode, color, flags)
            if ok then patched = patched + 1 end
            if inspect and user32.IsWindowVisible(hwnd) ~= 0 then
                local tn = user32.GetWindowTextW(hwnd, wide_buf, 260)
                local title = tn > 0 and narrow(wide_buf) or ""
                local cn = user32.GetClassNameW(hwnd, wide_buf, 260)
                local cls = cn > 0 and narrow(wide_buf) or ""
                info[#info + 1] = {
                    pid = tonumber(pid_buf[0]),
                    title = title,
                    cls = cls,
                    style = user32.GetWindowLongW(hwnd, GWL_STYLE),
                    ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE),
                    ok = ok,
                    hr = hr,
                }
            end
        end
        hwnd = user32.FindWindowExW(nil, hwnd, SDL_CLASS, nil)
    end
    local prev = acrylic_active
    local prev_mode = acrylic_mode
    if not enabled then patched_hwnds = {} end
    acrylic_active = enabled and patched > 0
    acrylic_mode = acrylic_active and mode or ""
    if acrylic_active ~= prev or acrylic_mode ~= prev_mode then
        logger:info(string.format("[lumina-extended] desktop acrylic %s (%d windows, mode=%s)",
            acrylic_active and "enabled" or "disabled", patched, mode))
    end
    return patched, info, nil
end

function PatchAcrylic(spec)
    if type(spec) == "table" and type(spec.spec) == "string" then spec = spec.spec end
    local opts = {}
    if type(spec) == "string" and #spec > 0 then
        local ok, parsed = pcall(json.decode, spec)
        if ok and type(parsed) == "table" then opts = parsed end
    elseif type(spec) == "table" then
        opts = spec
    elseif type(spec) == "boolean" then
        opts.enabled = spec
    end
    -- passed values take precedence over config.json
    local enabled, mode = opts.enabled, opts.mode
    if type(enabled) ~= "boolean" or type(mode) ~= "string" then
        local cfg_enabled, cfg_mode = read_acrylic_config()
        if type(enabled) ~= "boolean" then enabled = cfg_enabled end
        if type(mode) ~= "string" then mode = cfg_mode end
    end
    opts.mode = mode
    acrylic_wanted = enabled
    if not enabled and not acrylic_active and not opts.inspect then
        return json.encode({ ok = true, enabled = false, patched = 0 })
    end
    local patched, info, err = apply_acrylic(enabled, opts)
    if err then
        return json.encode({ ok = false, enabled = enabled, error = err })
    end
    local out = { ok = true, enabled = enabled, patched = patched, mode = opts.mode }
    if info then out.windows = info end
    return json.encode(out)
end

function AcrylicState()
    return json.encode({ enabled = acrylic_wanted })
end

-- lifecycle

local function on_load()
    local ok, err = pcall(function()
        find_roots()
        start_server()
    end)
    if not ok then logger:error("[lumina-extended] " .. tostring(err)) end
    millennium.ready()
end

local function on_unload()
    if acrylic_active then pcall(apply_acrylic, false) end
    stop_server()
end

return { on_load = on_load, on_unload = on_unload, on_frontend_loaded = function() end }
