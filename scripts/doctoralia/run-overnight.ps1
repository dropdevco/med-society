# Unattended Doctoralia scrape for one city.
#
#   powershell -ExecutionPolicy Bypass -File scripts/doctoralia/run-overnight.ps1 -City tijuana
#
# - Keeps Windows awake for as long as this window is open. The Juárez run lost
#   ~6 hours to the machine sleeping mid-request.
# - Re-runs scrape.ts after a crash. Both phases resume from disk, so a restart
#   only repeats the page that was in flight.
# - After the scrape, runs emails.ts: emails from each practice's own website.
# - Everything goes to out/<city>/run.log as well as the console.
# - scrape.ts holds a lock file, so starting this twice cannot double-append.
param(
  [string]$City = 'tijuana',
  [int]$MaxAttempts = 25
)

$ErrorActionPreference = 'Continue'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$outDir = Join-Path $PSScriptRoot "out\$City"
New-Item -ItemType Directory -Force $outDir | Out-Null
$log = Join-Path $outDir 'run.log'

Add-Type -Namespace Win32 -Name Power -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
'@
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED: no sleep while this process lives. The display may still turn off.
[Win32.Power]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null

Set-Location $repo
try {
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    "`n===== attempt $attempt · $(Get-Date -Format s) =====" | Tee-Object -FilePath $log -Append
    npx tsx scripts/doctoralia/scrape.ts all "--city=$City" 2>&1 | Tee-Object -FilePath $log -Append
    if ($LASTEXITCODE -eq 0) {
      # Emails: read from each practice's own website (third-party sites, not Doctoralia).
      # Resumable too; a failure here leaves the scrape itself complete.
      "`n===== scrape finished · $(Get-Date -Format s) · website email pass =====" | Tee-Object -FilePath $log -Append
      npx tsx scripts/doctoralia/emails.ts "--city=$City" 2>&1 | Tee-Object -FilePath $log -Append
      "`n===== finished · $(Get-Date -Format s) =====" | Tee-Object -FilePath $log -Append
      break
    }
    "`n----- exited $LASTEXITCODE, restarting in 60s -----" | Tee-Object -FilePath $log -Append
    Start-Sleep -Seconds 60
  }
}
finally {
  [Win32.Power]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null
}
