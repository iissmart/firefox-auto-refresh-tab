@echo off
del firefox-auto-refresh-tab.xpi 2>nul
del firefox-auto-refresh-tab.zip 2>nul
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "$root = (Get-Location).Path;" ^
  "$exclude = @('.git', '.gitattributes', 'pack.bat', 'pack.sh', 'screenshots', 'firefox-auto-refresh-tab.xpi', 'firefox-auto-refresh-tab.zip');" ^
  "$zipPath = Join-Path $root 'firefox-auto-refresh-tab.zip';" ^
  "$archive = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create');" ^
  "Get-ChildItem -Path . -File -Recurse | ForEach-Object {" ^
  "  $rel = $_.FullName.Substring($root.Length + 1);" ^
  "  $skip = $false;" ^
  "  foreach ($e in $exclude) { if ($rel -eq $e -or $rel.StartsWith($e + [char]92)) { $skip = $true; break } };" ^
  "  if (-not $skip) { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $rel.Replace([char]92, '/')) | Out-Null }" ^
  "};" ^
  "$archive.Dispose();" ^
  "Rename-Item 'firefox-auto-refresh-tab.zip' 'firefox-auto-refresh-tab.xpi'"
