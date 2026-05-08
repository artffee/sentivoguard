// SentivoGuard — shared threat patterns
// Each scanner imports this and applies the categories that fit its language.
// Patterns intentionally err toward false-positive (CAUTION) over false-negative.

const HIGH = "HIGH", MEDIUM = "MEDIUM", LOW = "LOW";

// Per-category list of { regex, severity, message }.
// Regex is created without /g — the caller iterates with .exec() in a loop.
function p(re, severity, message) {
  return { regex: new RegExp(re.source, re.flags.replace("g", "") + "g"), severity, message };
}

const PATTERNS = {
  credential_theft: [
    p(/keytar\s*\.\s*(get|find)Password\s*\(/g, HIGH,
      "Reads stored credentials from system keychain (keytar)"),
    p(/process\.env\.[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*/g, MEDIUM,
      "Reads sensitive environment variable"),
    p(/readFileSync\([^)]*\.ssh[/\\]id_(?:rsa|ed25519|ecdsa|dsa)/g, HIGH,
      "Reads private SSH key file"),
    p(/readFileSync\([^)]*\.aws[/\\]credentials/g, HIGH,
      "Reads AWS credentials file"),
    p(/(?:document\.cookie|chrome\.cookies\.getAll|browser\.cookies)/g, MEDIUM,
      "Reads browser cookies"),
    p(/Login Data|Cookies|Web Data/g, LOW,
      "References Chrome credential database file names")
  ],

  network_exfil: [
    p(/https?:\/\/[a-z0-9-]+\.(?:onion|bit|ml|ga|cf|tk|gq)/gi, HIGH,
      "Connection to suspicious TLD (onion/bit/ml/ga/cf/tk/gq)"),
    p(/(?:axios|fetch|got|node-fetch|request)\s*\(\s*['"`]https?:\/\/(?:\d{1,3}\.){3}\d{1,3}/g, MEDIUM,
      "Outbound HTTP to a raw IP literal"),
    p(/Buffer\.from\([^)]+\)\.toString\(\s*['"](?:base64|hex)['"]\s*\)\s*[;,]?\s*(?:\.then|\(|fetch|http)/g, HIGH,
      "Encoded payload sent over network (likely exfiltration)"),
    p(/discord(?:app)?\.com\/api\/webhooks/g, HIGH,
      "Posts to a Discord webhook (common exfil channel)"),
    p(/api\.telegram\.org\/bot/g, HIGH,
      "Posts to Telegram bot API (common exfil channel)")
  ],

  code_execution: [
    p(/\beval\s*\(/g, HIGH,
      "eval() — executes arbitrary string as code"),
    p(/new\s+Function\s*\(/g, HIGH,
      "new Function() — executes arbitrary string as code"),
    p(/child_process\s*\.\s*(?:exec|execSync|spawn|spawnSync)\s*\(/g, MEDIUM,
      "Spawns a child process"),
    p(/child_process\s*\.\s*exec(?:Sync)?\s*\([^)]*\$\{/g, HIGH,
      "Spawns a child process with template-literal interpolation (shell injection risk)"),
    p(/require\s*\(\s*[`'"][^`'"]*\$\{/g, MEDIUM,
      "Dynamic require() with interpolation"),
    p(/Object\.constructor\.constructor/g, MEDIUM,
      "Reflective constructor lookup (sandbox escape pattern)")
  ],

  obfuscation: [
    p(/eval\s*\(\s*atob\s*\(/g, HIGH,
      "eval(atob(...)) — decodes and executes base64 payload"),
    p(/eval\s*\(\s*Buffer\.from\(/g, HIGH,
      "eval(Buffer.from(...)) — decodes and executes encoded payload"),
    p(/['"`][A-Za-z0-9+/=]{300,}['"`]/g, MEDIUM,
      "Very long base64-looking string literal (possible packed payload)"),
    p(/(?:\\x[0-9a-f]{2}){8,}/gi, MEDIUM,
      "Long sequence of hex-escape characters"),
    p(/_0x[a-f0-9]{4,6}\s*=\s*\[/gi, MEDIUM,
      "Variable name pattern from JS obfuscators (_0xNNNN array)")
  ],

  persistence: [
    p(/HKEY_(?:LOCAL_MACHINE|CURRENT_USER)[\\/].*[\\/]Run/gi, HIGH,
      "Writes a registry Run key (Windows persistence)"),
    p(/[\\/]\.config[\\/]autostart[\\/]/g, MEDIUM,
      "Writes to XDG autostart directory"),
    p(/(?:crontab|systemctl|launchctl)\s+/g, MEDIUM,
      "Modifies cron / systemd / launchd"),
    p(/Add-MpPreference\s+-ExclusionPath/gi, HIGH,
      "Adds Defender exclusion path (suppresses AV detection)"),
    p(/schtasks(?:\.exe)?\s+\/create/gi, HIGH,
      "Creates a scheduled task (Windows persistence)")
  ],

  cryptomining: [
    p(/coinhive|crypto-loot|webminerpool|jsecoin|cryptonight/gi, HIGH,
      "References a known browser cryptominer"),
    p(/stratum\+(?:tcp|ssl):\/\//gi, HIGH,
      "Connects to a stratum mining pool"),
    p(/\bxmrig\b/gi, HIGH,
      "References xmrig miner")
  ],

  ransomware: [
    p(/your\s+files\s+have\s+been\s+encrypted/gi, HIGH,
      "Ransom note text"),
    p(/(?:CryptoJS|crypto)\.(?:AES|createCipheriv)[\s\S]{0,200}walk(?:Sync)?/g, HIGH,
      "Recursive walk + AES encryption (ransomware pattern)"),
    p(/\.(locked|encrypted|crypto)['"`]/g, LOW,
      "Hard-codes ransomware-style file extension")
  ]
};

// Patterns specific to Windows shell / dropper scripts (PowerShell, batch, VBS).
// Used by the disk scanner on top of the base PATTERNS above.
const SHELL_PATTERNS = {
  shell_dropper: [
    p(/powershell(?:\.exe)?\s+(?:[^|]*?\s)?(?:-e|-enc|-encodedcommand)\s/gi, HIGH,
      "Encoded PowerShell command (commonly used to bypass detection)"),
    p(/IEX\s*\(\s*New-Object\s+Net\.WebClient\)\.DownloadString/gi, HIGH,
      "PowerShell download-and-execute pattern (IEX + WebClient)"),
    p(/Invoke-Expression\s+\(?\s*\(?(?:Invoke-WebRequest|wget|curl)/gi, HIGH,
      "PowerShell remote-script execution"),
    p(/Invoke-WebRequest[^\n]*-OutFile[^\n]*\.(?:exe|dll|scr|bat|ps1)/gi, HIGH,
      "PowerShell downloads an executable to disk"),
    p(/Set-MpPreference\s+-Disable(?:RealtimeMonitoring|IOAVProtection|BehaviorMonitoring)/gi, HIGH,
      "Disables Windows Defender real-time / behavior protection"),
    p(/certutil(?:\.exe)?\s+(?:-urlcache|-decode|-decodehex)/gi, HIGH,
      "certutil abuse (common malware delivery / payload decode)"),
    p(/bitsadmin(?:\.exe)?\s+\/transfer/gi, HIGH,
      "bitsadmin transfer (malware delivery)"),
    p(/wmic(?:\.exe)?\s+process\s+call\s+create/gi, HIGH,
      "WMIC process create (lateral movement / code execution)"),
    p(/reg(?:\.exe)?\s+(?:add|import)[^\n]*\\Run/gi, HIGH,
      "Registry persistence (Run key)"),
    p(/-WindowStyle\s+Hidden/gi, MEDIUM,
      "Hidden-window execution (common evasion)"),
    p(/-ExecutionPolicy\s+Bypass/gi, MEDIUM,
      "PowerShell execution-policy bypass")
  ],

  vbs_dropper: [
    p(/CreateObject\s*\(\s*["'](?:WScript\.Shell|Shell\.Application|MSXML2\.(?:XMLHTTP|ServerXMLHTTP)|ADODB\.Stream)/gi, MEDIUM,
      "VBS object creation common in droppers"),
    p(/\.Run\s+["'][^"']*\.exe/gi, MEDIUM,
      "VBS launches an executable"),
    p(/(?:GetObject|CreateObject)\s*\([^)]*Scripting\.FileSystemObject/gi, LOW,
      "Filesystem manipulation via FileSystemObject")
  ]
};

// Python-specific patterns layered on top of the base set for pip scans.
const PYTHON_PATTERNS = {
  py_exec: [
    p(/\bexec\s*\(/g,                              HIGH,   "exec() — runs arbitrary string as Python code"),
    p(/\b__import__\s*\(/g,                        MEDIUM, "Dynamic __import__() (often used to hide imports)"),
    p(/\bcompile\s*\([^)]*[\"']<string>[\"']/g,    MEDIUM, "compile() of a string source"),
    p(/\bos\.system\s*\(/g,                        HIGH,   "os.system() — shell execution"),
    p(/\bsubprocess\.(?:Popen|run|call|check_output|check_call)\s*\([^)]*shell\s*=\s*True/g,
                                                   HIGH,   "subprocess with shell=True (injection risk)"),
    p(/\bpickle\.loads?\s*\(/g,                    HIGH,   "pickle.loads() — arbitrary code on deserialize"),
    p(/\bmarshal\.loads?\s*\(/g,                   HIGH,   "marshal.loads() — arbitrary code on deserialize"),
    p(/\byaml\.(?:load|unsafe_load)\s*\([^)]*(?!Loader\s*=\s*\w*Safe)/g,
                                                   MEDIUM, "yaml.load without SafeLoader")
  ],
  py_setup_exec: [
    p(/from\s+setuptools[^\n]*\nimport\s+(?:os|subprocess|urllib|requests)/g, HIGH,
      "setup.py imports network/exec libs (runs at install)"),
    p(/setup\([^)]*cmdclass\s*=/g,                 HIGH,
      "Custom setup.py cmdclass — runs at install time")
  ]
};

// Ruby-specific patterns for gem scans.
const RUBY_PATTERNS = {
  rb_exec: [
    p(/\bMarshal\.load\s*\(/g,                   HIGH,   "Marshal.load — arbitrary code on deserialize"),
    p(/\bYAML\.load\s*\(/g,                      MEDIUM, "YAML.load (use safe_load instead)"),
    p(/`[^`]+`/g,                                MEDIUM, "Backtick command execution"),
    p(/\bsystem\s*\(/g,                          MEDIUM, "system() shell execution"),
    p(/\b(?:exec|fork)\s*\(/g,                   HIGH,   "exec()/fork() — process spawn"),
    p(/Open3\.(?:popen|capture|pipeline)/g,      MEDIUM, "Open3 process pipelines"),
    p(/Net::HTTP|RestClient|HTTParty|Faraday/g,  LOW,    "Outbound HTTP client"),
    p(/ENV\.to_h|ENV\[\s*[\"'][\w_]+[\"']\s*\]/g,LOW,    "Reads environment variables")
  ]
};

// Dropper / phishing patterns inside browser extension JS.
const EXTENSION_PATTERNS = {
  ext_keylogger: [
    p(/addEventListener\s*\(\s*[\"'](?:keydown|keypress|keyup|input)/g, MEDIUM,
      "Listens to keystrokes (potential keylogger)"),
    p(/document\.cookie/g,                       MEDIUM, "Reads document.cookie"),
    p(/localStorage\.(?:getItem|setItem)/g,      LOW,    "Accesses localStorage")
  ]
};

// File extensions each scanner cares about.
const EXTS = {
  npm:    [".js", ".mjs", ".cjs", ".ts", ".tsx", ".json"],
  folder: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".rb", ".sh", ".ps1", ".bat", ".php", ".pl"],
  pip:    [".py"],
  gem:    [".rb"],
  // Disk: textual scripts the scanner reads pattern-by-pattern.
  // Binary files (exe/dll/etc) are checked by name + location instead.
  disk_text:   [".js", ".mjs", ".cjs", ".ts", ".py", ".rb", ".sh",
                ".ps1", ".psm1", ".bat", ".cmd", ".vbs", ".vbe",
                ".wsf", ".wsh", ".jse", ".hta", ".php", ".pl"],
  disk_binary: [".exe", ".dll", ".scr", ".com", ".pif", ".cpl", ".msi",
                ".jar", ".ocx"]
};

// Suspicious filename patterns — typo-squatted system processes, double-extension lures.
const SUSPICIOUS_NAMES = [
  { rx: /^svch0st\.exe$/i,                          severity: HIGH,
    message: "Typo-squatted svchost.exe (zero instead of 'o')" },
  { rx: /^expIorer\.exe$/i,                         severity: HIGH,
    message: "Typo-squatted explorer.exe (capital I instead of l)" },
  { rx: /^[\w.\- ]+\.(?:pdf|docx?|xlsx?|jpe?g|png|txt|zip)\.(?:exe|scr|com|pif|bat|cmd|js|vbs)$/i,
    severity: HIGH,
    message: "Double extension — disguised as document/image" },
  { rx: /^[a-f0-9]{16,}\.(?:exe|scr)$/i,            severity: MEDIUM,
    message: "Hex-encoded filename (common malware payload naming)" },
  { rx: /^(invoice|receipt|order|payment|delivery|tracking|resume|cv|salary|payslip)[_\- ]?\w*\.(?:exe|scr|com|js|vbs|jar)$/i,
    severity: HIGH,
    message: "Phishing-themed executable filename" }
];

// Returns null if location is fine, else a finding-shape object.
function locationRisk(filePath) {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");

  if (/\/appdata\/local\/temp\/.*\.(exe|dll|scr|bat|cmd|ps1|vbs|js)$/i.test(lower))
    return { severity: HIGH, message: "Executable / script in user Temp directory" };

  if (/\/windows\/temp\/.*\.(exe|dll|scr|bat|ps1)$/i.test(lower))
    return { severity: HIGH, message: "Executable in Windows Temp directory" };

  if (/\/downloads\/.*\.(scr|pif|com|hta|jse|wsh)$/i.test(lower))
    return { severity: HIGH, message: "Rare-extension executable in Downloads" };

  if (/\/downloads\/.*\.(exe|msi|bat|cmd|ps1)$/i.test(lower))
    return { severity: LOW, message: "Executable in Downloads — verify the source" };

  if (/\/appdata\/roaming\/.*\.(exe|dll|scr)$/i.test(lower) &&
      !/\/(microsoft|google|mozilla|discord|spotify|zoom|slack|notion|code|cursor|github desktop|figma|telegram desktop|signal|adobe|nvidia|riot games|epic games|steam)\//i.test(lower))
    return { severity: MEDIUM, message: "Executable in AppData\\Roaming outside known-vendor folders" };

  if (/\/start menu\/programs\/startup\/.*\.(exe|bat|cmd|vbs|ps1|lnk)$/i.test(lower))
    return { severity: MEDIUM, message: "Auto-starting item in Startup folder (verify it's expected)" };

  return null;
}

module.exports = {
  PATTERNS, SHELL_PATTERNS, PYTHON_PATTERNS, RUBY_PATTERNS, EXTENSION_PATTERNS,
  EXTS, SUSPICIOUS_NAMES, locationRisk
};
