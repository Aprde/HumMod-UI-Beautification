param([string]$CacheDirectory = (Join-Path $PSScriptRoot '.cache'))
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$version = '0.1.0'
$nodeVersion = '22.23.2'
$sdkVersion = '1.0.4191.47'
$nodeHash = '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'
$sdkHash = 'f492bbf547d0da329553b6727435b677579b1e9f91cc9e4a1ad029366d5f23d0'
New-Item -ItemType Directory -Force $CacheDirectory | Out-Null
function Get-VerifiedArchive($Url, $File, $Hash) {
    if (-not (Test-Path -LiteralPath $File)) { Invoke-WebRequest $Url -OutFile $File -UseBasicParsing }
    if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw "Checksum mismatch: $File" }
}
$nodeZip = Join-Path $CacheDirectory "node-v$nodeVersion-win-x64.zip"
$sdkZip = Join-Path $CacheDirectory "webview2-$sdkVersion.zip"
Get-VerifiedArchive "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-win-x64.zip" $nodeZip $nodeHash
Get-VerifiedArchive "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg" $sdkZip $sdkHash
$nodeExtract = Join-Path $CacheDirectory 'node'
$sdk = Join-Path $CacheDirectory 'webview2'
Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract -Force
Expand-Archive -LiteralPath $sdkZip -DestinationPath $sdk -Force
$node = Join-Path $nodeExtract "node-v$nodeVersion-win-x64"
$name = "HumMod-UI-Beautification-v$version-windows-x64"
$output = Join-Path $root "dist\$name"
New-Item -ItemType Directory -Force $output,(Join-Path $output 'app'),(Join-Path $output 'runtime'),(Join-Path $output 'licenses') | Out-Null
foreach ($privateFolder in @('engine','sessions','workspace-state','Experiments')) {
    if (Test-Path -LiteralPath (Join-Path $output "app\$privateFolder")) { throw 'The build folder contains runtime data. Use a clean output folder.' }
}
foreach ($file in @('app.js','catalog.mjs','index.html','projects.mjs','server.mjs','style.css')) { Copy-Item -LiteralPath (Join-Path $root "app\$file") -Destination (Join-Path $output 'app') -Force }
Copy-Item -LiteralPath (Join-Path $root 'app\assets') -Destination (Join-Path $output 'app') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $node 'node.exe') -Destination (Join-Path $output 'runtime\node.exe') -Force
Copy-Item -LiteralPath (Join-Path $node 'LICENSE') -Destination (Join-Path $output 'licenses\Node-LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $output 'licenses\WebView2-LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $sdk 'NOTICE.txt') -Destination (Join-Path $output 'licenses\WebView2-NOTICE.txt') -Force
foreach ($file in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) { Copy-Item -LiteralPath (Join-Path $sdk "lib\net462\$file") -Destination $output -Force }
Copy-Item -LiteralPath (Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $output -Force
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw '.NET Framework 4.x is required to build.' }
& $csc /nologo /target:exe /platform:x64 "/out:$output\app\NativeBridge.exe" /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll (Join-Path $root 'native\NativeBridge.cs')
if ($LASTEXITCODE -ne 0) { throw 'Bridge compilation failed.' }
& $csc /nologo /target:winexe /platform:x64 "/out:$output\HumMod Studio.exe" "/win32icon:$root\app\assets\hummod.ico" "/win32manifest:$root\native\app.manifest" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Net.Http.dll "/reference:$output\Microsoft.Web.WebView2.Core.dll" "/reference:$output\Microsoft.Web.WebView2.WinForms.dll" (Join-Path $root 'native\Desktop.cs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed.' }
@'
<?xml version="1.0" encoding="utf-8"?>
<configuration><startup useLegacyV2RuntimeActivationPolicy="true"><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.7.2"/></startup></configuration>
'@ | Set-Content -LiteralPath (Join-Path $output 'HumMod Studio.exe.config') -Encoding UTF8
foreach ($file in @('README.md','LICENSE','THIRD-PARTY-NOTICES.md')) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $output -Force }
Copy-Item -LiteralPath (Join-Path $root 'docs') -Destination $output -Recurse -Force
& (Join-Path $node 'node.exe') --check (Join-Path $output 'app\server.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Server syntax check failed.' }
$archive = Join-Path $root "dist\$name.zip"
Compress-Archive -Path (Join-Path $output '*') -DestinationPath $archive -Force
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $name.zip" | Set-Content -LiteralPath (Join-Path $root 'dist\SHA256SUMS.txt') -Encoding ASCII
Write-Host "Built: $archive"
