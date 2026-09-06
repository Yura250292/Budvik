# Probe: which 1C infobases live on this server besides "kavetskiy", and is
# there an accounting base (Buhgalteriya) among them?
#
# Why: in the UT base money is cash only -- bank documents are empty or absent
# (probe-bank-payments.ps1, 10.08.2026). A trading company with bank accounts
# must book the bank SOMEWHERE, and M.E.Doc is installed here, which usually
# feeds from an accounting base. The first discovery (discover.ps1, 09.08)
# looked only at the current user's infobase list and never at the cluster
# registry, other users' lists, the SQL databases or running sessions.
#
# Every step is READ-ONLY: files are read, nothing is created or changed.
# Passwords that may appear in cluster files or process command lines are
# masked before printing.
#
# Run in 32-bit PowerShell (the COM part needs it; file parts work anywhere):
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ep bypass -f \\tsclient\Downloads\probe-server-bases.ps1 > \\tsclient\Downloads\probe-server-bases.out.txt 2>&1
# If sections 1-2 report "access denied", rerun from an elevated prompt
# ("Run as administrator") -- other users' profiles need it.
#
# ASCII-only on purpose: PowerShell 5 reads .ps1 as ANSI.

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

function Section($t) { ""; "============================================================"; $t; "============================================================" }
function Mask($s) {
    if (-not $s) { return $s }
    $s = [regex]::Replace($s, '(?i)(Pwd=")[^"]*(")', '$1***$2')
    $s = [regex]::Replace($s, '(?i)(Pwd=)[^;"\s]+', '$1***')
    $s = [regex]::Replace($s, '(?i)(/P\s+)\S+', '$1***')
    return $s
}

"1C SERVER: INFOBASE DISCOVERY (read-only)"
"Time:     $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
"Computer: $env:COMPUTERNAME"
"User:     $env:USERNAME"
$is64 = [Environment]::Is64BitProcess
"Process:  " + $(if ($is64) { "64-bit (COM section will be skipped -- use SysWOW64 powershell)" } else { "32-bit" })
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
"Elevated: $admin"

# --- 0. Ask the cluster itself (COM agent API, 8.2) -------------------------
Section "0. CLUSTER VIA COM: infobases and live sessions"
if ($is64) {
    "  skipped: 64-bit process cannot load V82.COMConnector"
} else {
    try {
        $conn = New-Object -ComObject "V82.COMConnector"
        $agent = $conn.ConnectAgent($env:COMPUTERNAME)
        $clusters = $agent.GetClusters()
        "  clusters: $($clusters.Count)"
        foreach ($cl in $clusters) {
            "  cluster '$($cl.ClusterName)' host=$($cl.HostName) port=$($cl.MainPort)"
            $authOk = $false
            try { $agent.Authenticate($cl, "", ""); $authOk = $true } catch { "    cluster admin auth (empty) failed: $($_.Exception.Message)" }
            if ($authOk) {
                try {
                    $ibs = $agent.GetInfoBases($cl)
                    "    INFOBASES: $($ibs.Count)"
                    foreach ($ib in $ibs) { "      [{0}]  {1}" -f $ib.Name, $ib.Descr }
                } catch { "    GetInfoBases failed: $($_.Exception.Message)" }
                try {
                    $sessions = $agent.GetSessions($cl)
                    "    SESSIONS now: $($sessions.Count)"
                    foreach ($s in $sessions) {
                        "      base={0,-14} user={1,-28} app={2,-12} host={3,-16} since={4}" -f `
                            $s.infoBase.Name, $s.userName, $s.AppID, $s.Host, $s.StartedAt
                    }
                } catch { "    GetSessions failed: $($_.Exception.Message)" }
            }
        }
    } catch { "  COM agent unavailable: $($_.Exception.Message)" }
}

# --- 1. Cluster registry file: every infobase with its DBMS database --------
Section "1. CLUSTER REGISTRY (1CV8Clst.lst)"
$lst = @()
foreach ($svc in (Get-CimInstance Win32_Service -EA 0 | Where-Object { $_.Name -match '1C' })) {
    "  service [$($svc.State)] $($svc.Name): $($svc.PathName)"
    if ($svc.PathName -match '-d\s+"?([^"]+?)"?(\s+-|$)') {
        $d = $Matches[1].Trim()
        "    srvinfo dir from service: $d"
        Get-ChildItem $d -Filter "1CV8Clst.lst" -Recurse -Depth 2 -EA 0 | ForEach-Object { $lst += $_.FullName }
    }
}
foreach ($root in @("C:\Program Files (x86)\1cv82", "C:\Program Files\1cv82", "C:\Program Files (x86)\1cv8", "C:\Program Files\1cv8", "C:\ProgramData\1C", "D:\")) {
    if (Test-Path $root) {
        Get-ChildItem $root -Filter "1CV8Clst.lst" -Recurse -Depth 4 -EA 0 -Force | ForEach-Object { $lst += $_.FullName }
    }
}
Get-ChildItem "C:\Users\*\AppData\Local\1C" -Filter "1CV8Clst.lst" -Recurse -Depth 5 -EA 0 -Force | ForEach-Object { $lst += $_.FullName }
$lst = $lst | Select-Object -Unique
if (-not $lst) { "  1CV8Clst.lst not found (search may need elevation)" }
foreach ($f in $lst) {
    ""
    "  File: $f  (modified $((Get-Item $f).LastWriteTime))"
    try {
        $raw = Get-Content $f -Raw -EA Stop
        # Record layout: {guid,"Name","Descr","DBMS","DBServer","DBName","DBUser","DBPwd",...}
        # Only the first six fields are printed; user/password are never echoed.
        $rx = '\{([0-9a-fA-F\-]{36}),"([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"'
        $ms = [regex]::Matches($raw, $rx)
        "  infobases in registry: $($ms.Count)"
        foreach ($m in $ms) {
            "    [{0,-14}] descr='{1}'  dbms={2}  server={3}  db={4}" -f $m.Groups[2].Value, $m.Groups[3].Value, $m.Groups[4].Value, $m.Groups[5].Value, $m.Groups[6].Value
        }
    } catch { "  cannot read: $($_.Exception.Message)" }
}

# --- 2. Infobase lists of every user profile --------------------------------
Section "2. INFOBASE LISTS OF ALL USERS (ibases.v8i)"
$v8i = @()
Get-ChildItem "C:\Users\*\AppData\Roaming\1C\1CEStart\ibases.v8i" -EA 0 -Force | ForEach-Object { $v8i += $_.FullName }
if (Test-Path "C:\ProgramData\1C\1CEStart\ibases.v8i") { $v8i += "C:\ProgramData\1C\1CEStart\ibases.v8i" }
if (-not $v8i) { "  none readable (other profiles need elevation)" }
foreach ($f in $v8i) {
    ""
    "  File: $f"
    try {
        Get-Content $f -EA Stop | Where-Object { $_ -match '^\[|^Connect=' } | ForEach-Object { "    " + (Mask $_) }
    } catch { "    cannot read: $($_.Exception.Message)" }
}
$profiles = Get-ChildItem "C:\Users" -Directory -EA 0 | Select-Object -ExpandProperty Name
"  user profiles on this machine: " + ($profiles -join ", ")

# --- 3. SQL Server databases --------------------------------------------------
Section "3. SQL SERVER DATABASES"
$sqlOk = $false
try {
    $q = "SET NOCOUNT ON; SELECT d.name, CONVERT(varchar(10), d.create_date, 120) AS created, (SELECT SUM(CAST(f.size AS bigint))*8/1024 FROM sys.master_files f WHERE f.database_id = d.database_id) AS mb FROM sys.databases d WHERE d.database_id > 4 ORDER BY d.name"
    $out = & sqlcmd -S localhost -E -h -1 -W -s "|" -Q $q 2>&1
    if ($LASTEXITCODE -eq 0 -and $out -notmatch 'Login failed') {
        $sqlOk = $true
        "  name | created | size MB"
        $out | ForEach-Object { if ("$_".Trim()) { "    $_" } }
    } else { "  sqlcmd: $($out -join ' ')" }
} catch { "  sqlcmd unavailable: $($_.Exception.Message)" }
if (-not $sqlOk) {
    "  falling back to data files on disk (.mdf):"
    $dirs = @()
    Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server" -EA 0 | ForEach-Object {
        $p = Join-Path $_.PSPath "MSSQLServer"
        $v = Get-ItemProperty $p -EA 0
        if ($v.DefaultData) { $dirs += $v.DefaultData }
        $s = Get-ItemProperty (Join-Path $_.PSPath "Setup") -EA 0
        if ($s.SQLDataRoot) { $dirs += (Join-Path $s.SQLDataRoot "DATA") }
    }
    $dirs += "C:\Program Files\Microsoft SQL Server"
    $dirs += "D:\"
    $seen = @{}
    foreach ($d in ($dirs | Select-Object -Unique)) {
        if (-not (Test-Path $d)) { continue }
        Get-ChildItem $d -Filter "*.mdf" -Recurse -Depth 4 -EA 0 -Force | ForEach-Object {
            if (-not $seen[$_.FullName]) {
                $seen[$_.FullName] = 1
                "    {0,-40} {1,8:N0} MB  modified {2}" -f $_.Name, ($_.Length / 1MB), $_.LastWriteTime
            }
        }
    }
    if ($seen.Count -eq 0) { "    no .mdf visible (data folder needs elevation)" }
}

# --- 4. File infobases --------------------------------------------------------
Section "4. FILE INFOBASES (1Cv8.1CD)"
Get-PSDrive -PSProvider FileSystem -EA 0 | Where-Object { $_.Used -gt 0 } | ForEach-Object {
    Get-ChildItem "$($_.Root)" -Filter "1Cv8.1CD" -Recurse -Depth 5 -EA 0 -Force | ForEach-Object {
        "  {0}  {1:N2} GB  modified {2}" -f $_.FullName, ($_.Length / 1GB), $_.LastWriteTime
    }
}

# --- 5. Who runs 1C right now ---------------------------------------------------
Section "5. 1C PROCESSES (owner, base from command line)"
$procs = Get-CimInstance Win32_Process -EA 0 | Where-Object { $_.Name -match '^(1cv8|1cv8c|1cv8s|ragent|rmngr|rphost)' }
if (-not $procs) { "  none" }
foreach ($p in $procs) {
    $owner = ""
    try { $o = Invoke-CimMethod -InputObject $p -MethodName GetOwner -EA Stop; $owner = "$($o.Domain)\$($o.User)" } catch { $owner = "?" }
    "  {0,-10} pid={1,-6} owner={2,-24} started={3}" -f $p.Name, $p.ProcessId, $owner, $p.CreationDate
    if ($p.CommandLine) { "      " + (Mask $p.CommandLine) }
}

# --- 6. M.E.Doc ---------------------------------------------------------------
Section "6. M.E.DOC (tax reporting -- which base feeds it?)"
$medoc = @()
Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -EA 0 | ForEach-Object {
    $v = Get-ItemProperty $_.PSPath -EA 0
    if ($v.DisplayName -match '(?i)M\.?E\.?Doc|Medoc|Sota') {
        "  installed: $($v.DisplayName) $($v.DisplayVersion)  at $($v.InstallLocation)"
        if ($v.InstallLocation) { $medoc += $v.InstallLocation }
    }
}
foreach ($d in @("C:\Program Files (x86)\Medoc", "C:\Program Files\Medoc", "C:\Medoc", "D:\Medoc", "C:\ProgramData\Medoc")) { if (Test-Path $d) { $medoc += $d } }
$medoc = $medoc | Select-Object -Unique
if (-not $medoc) { "  no M.E.Doc folder found in standard places" }
foreach ($d in $medoc) {
    ""
    "  Folder: $d"
    Get-ChildItem $d -Directory -EA 0 | ForEach-Object { "    dir  $($_.Name)  (modified $($_.LastWriteTime))" }
    # Exchange folders show what flows between 1C and M.E.Doc (tax invoices, statements).
    Get-ChildItem $d -Directory -Recurse -Depth 2 -EA 0 | Where-Object { $_.Name -match '(?i)export|import|exchange|obmen|xml|1c' } | ForEach-Object {
        $n = (Get-ChildItem $_.FullName -File -EA 0 | Measure-Object).Count
        $newest = Get-ChildItem $_.FullName -File -EA 0 | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        "    exchange? $($_.FullName)  files=$n  newest=$($newest.LastWriteTime) $($newest.Name)"
    }
}

# --- 7. Other 1C installs and configuration templates -----------------------
Section "7. OTHER 1C INSTALLS / TEMPLATES (names reveal Buhgalteriya, Zarplata...)"
foreach ($d in @("D:\install", "C:\install", "C:\Distr", "D:\Distr")) {
    if (Test-Path $d) {
        "  $d"
        Get-ChildItem $d -Directory -EA 0 | ForEach-Object { "    $($_.Name)  (modified $($_.LastWriteTime))" }
    }
}
$tmpl = @()
Get-ChildItem "C:\Users\*\AppData\Roaming\1C\1Cv82\tmplts", "C:\Users\*\AppData\Roaming\1C\1cv8\tmplts", "C:\Program Files (x86)\1cv82\tmplts", "C:\Program Files (x86)\1cv8\tmplts", "C:\Program Files\1cv8\tmplts" -Directory -EA 0 -Force | ForEach-Object { $tmpl += $_.FullName }
if (-not $tmpl) { "  no template folders" }
foreach ($t in $tmpl) {
    "  templates: $t"
    Get-ChildItem $t -Directory -Recurse -Depth 2 -EA 0 | ForEach-Object { "    " + $_.FullName.Substring($t.Length) }
}
"  configuration files (*.cf/*.cfu/*.dt) on D: and in Downloads/Desktop:"
foreach ($d in @("D:\", "C:\Users\*\Downloads", "C:\Users\*\Desktop")) {
    Get-ChildItem $d -Include "*.cf", "*.cfu", "*.dt" -Recurse -Depth 3 -EA 0 -Force | ForEach-Object {
        "    {0}  {1:N0} MB  {2}" -f $_.FullName, ($_.Length / 1MB), $_.LastWriteTime
    }
}

# --- 8. Everything installed (bank clients, other 1C/BAS products) ------------
Section "8. INSTALLED PROGRAMS (look for bank clients, BAS, Zvit, Vchasno...)"
$names = @()
Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" -EA 0 | ForEach-Object {
    $v = Get-ItemProperty $_.PSPath -EA 0
    if ($v.DisplayName -and $v.DisplayName -notmatch '^(KB\d+|Microsoft Visual C\+\+|Microsoft \.NET|Windows )') {
        $names += ("{0}  {1}" -f $v.DisplayName, $v.DisplayVersion)
    }
}
$names | Sort-Object -Unique | ForEach-Object { "  $_" }

Section "DONE -- nothing was changed on the server"
""
