[CmdletBinding()]
param(
    [string]$Version
)

$name = 'firefox-auto-refresh-tab'
$root = $PSScriptRoot
Push-Location $root

try {
    if (-not $Version) {
        $describeOutput = & git describe --tags --long 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $describeOutput) {
            throw 'No git tag found. Create a tag (e.g. git tag 1.2.6) or pass -Version.'
        }
        $described = @($describeOutput)[0].Trim()

        $m = [regex]::Match($described, '^v?(?<base>.+)-(?<ahead>\d+)-g[0-9a-f]+$')
        if (-not $m.Success) {
            throw "Unexpected 'git describe' output: $described"
        }

        $base = $m.Groups['base'].Value
        $ahead = [int]$m.Groups['ahead'].Value
        $parts = $base.Split('.')
        # commits past the tag become a 4th component, e.g. 1.2.5 + 3 commits -> 1.2.5.3
        if ($ahead -gt 0 -and $parts.Count -lt 4) {
            $Version = (@($parts) + $ahead) -join '.'
        }
        else {
            $Version = $base
        }
    }

    $Version = $Version -replace '^v', ''
    if ($Version -notmatch '^(0|[1-9][0-9]{0,8})(\.(0|[1-9][0-9]{0,8})){0,3}$') {
        throw "Version '$Version' is not a valid Firefox extension version (1 to 4 dot-separated numbers)."
    }

    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $xpiPath = Join-Path $root "$name.xpi"
    $zipPath = Join-Path $root "$name.zip"
    Remove-Item -LiteralPath $xpiPath, $zipPath -ErrorAction SilentlyContinue

    $manifestText = [System.IO.File]::ReadAllText((Join-Path $root 'manifest.json'))
    $versionPattern = '"version"\s*:\s*"[^"]*"'
    if (-not [regex]::IsMatch($manifestText, $versionPattern)) {
        throw 'No "version" key found in manifest.json.'
    }
    $manifestText = [regex]::Replace($manifestText, $versionPattern, '"version": "' + $Version + '"')

    $exclude = @('.git', '.gitattributes', '.gitignore', '.github', 'pack.bat', 'pack.ps1', 'pack.sh', 'screenshots', "$name.xpi", "$name.zip")
    $archive = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
    try {
        Get-ChildItem -LiteralPath $root -File -Recurse | ForEach-Object {
            $rel = $_.FullName.Substring($root.Length + 1)
            foreach ($e in $exclude) {
                if ($rel -eq $e -or $rel.StartsWith($e + [char]92)) { return }
            }

            $entryName = $rel.Replace([char]92, '/')
            if ($entryName -eq 'manifest.json') {
                $entry = $archive.CreateEntry($entryName)
                $writer = New-Object System.IO.StreamWriter($entry.Open(), (New-Object System.Text.UTF8Encoding($false)))
                try { $writer.Write($manifestText) } finally { $writer.Dispose() }
            }
            else {
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName) | Out-Null
            }
        }
    }
    finally {
        $archive.Dispose()
    }

    Rename-Item -LiteralPath $zipPath -NewName "$name.xpi"
    Write-Host "Packed $name.xpi (version $Version)"
}
finally {
    Pop-Location
}
