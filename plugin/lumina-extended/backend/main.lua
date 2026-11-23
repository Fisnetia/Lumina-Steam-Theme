--[[
  lumina-extended: lists the Wallpaper Engine library and serves its files to the
  Lumina theme through a local server (server.ps1).

  Status() -> { base = "http://localhost:<port>/<token>/" } | { starting = true } | { error }
  List()   -> [ { id = "<root>/<folder>", title, type, file, preview } ]
  SetStill({ data = <base64 JPEG> }) -> { ok }: a still of the client's backdrop,
           served as Status().still for web pages (Store, Community), which
           can't read the client's storage
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
int CreateProcessW(const uint16_t *app, uint16_t *cmd, void *pa, void *ta, int inherit, uint32_t flags,
                   void *env, const uint16_t *cwd, LMWE_STARTUPINFOW *si, LMWE_PROCESS_INFORMATION *pi);
int MultiByteToWideChar(uint32_t cp, uint32_t flags, const char *s, int n, uint16_t *w, int wn);
int TerminateProcess(void *h, uint32_t code);
int CloseHandle(void *h);
uint32_t GetCurrentProcessId(void);
int CreateDirectoryW(const uint16_t *path, void *sa);
int MoveFileExW(const uint16_t *src, const uint16_t *dst, uint32_t flags);
long BCryptGenRandom(void *alg, uint8_t *buf, uint32_t n, uint32_t flags);
]]
local kernel32 = ffi.C
local bcrypt = ffi.load("bcrypt")

local CREATE_NO_WINDOW = 0x08000000
local MOVEFILE_REPLACE_EXISTING = 0x1
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
    stop_server()
end

return { on_load = on_load, on_unload = on_unload, on_frontend_loaded = function() end }
