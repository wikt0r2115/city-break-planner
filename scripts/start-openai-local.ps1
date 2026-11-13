$ErrorActionPreference = 'Stop'

$backend = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\backend')).Path
$jar = Join-Path $backend 'target\city-break-planner-0.0.1-SNAPSHOT.jar'
if (-not (Test-Path -LiteralPath $jar -PathType Leaf)) {
    throw 'Zbuduj backend poleceniem .\mvnw.cmd -B -ntp package w katalogu backend.'
}
$java = Get-Command java.exe -CommandType Application -All |
    Select-Object -First 1 -ExpandProperty Source
$port = if ($env:SERVER_PORT) { [int]$env:SERVER_PORT } else { 8080 }
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq $port |
    Select-Object -ExpandProperty OwningProcess -Unique)
$jarArgument = '\s-jar\s+(?:"{0}"|{0})(?=\s|$)' -f [regex]::Escape($jar)

foreach ($listener in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $listener"
    if ($process.Name -ine 'java.exe' -or $process.CommandLine -notmatch $jarArgument) {
        throw "Port $port jest zajety. Zatrzymaj proces zajmujacy port przed ponownym uruchomieniem."
    }
}

$previousKey = $env:OPENAI_API_KEY
$key = $previousKey
if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'User')
}
$key = if ([string]::IsNullOrWhiteSpace($key)) { '' } else { $key.Trim() }
if ($key -and $key -cnotmatch '^[!-~]{1,8192}$') {
    throw 'Wprowadz poprawny klucz OpenAI API.'
}

foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener
    Stop-Process -InputObject $process
    if (-not $process.WaitForExit(5000)) {
        throw "Backend nie zwolnil portu $port."
    }
}

Push-Location -LiteralPath $backend
try {
    $env:OPENAI_API_KEY = $key
    Write-Host 'Backend startuje. Pozostaw to okno otwarte podczas korzystania z planera.'
    & $java '-Djavax.net.ssl.trustStoreType=Windows-ROOT' '-Djavax.net.ssl.trustStore=NONE' -jar $jar
    if ($LASTEXITCODE -ne 0) {
        throw "Backend zakonczyl sie z kodem $LASTEXITCODE."
    }
}
finally {
    $env:OPENAI_API_KEY = $previousKey
    Pop-Location
}
