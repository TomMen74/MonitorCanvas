param(
    [int]$Port = 8765,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDirectory = Join-Path $env:LOCALAPPDATA "MonitorCanvas"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace MonitorCanvas
{
    public sealed class MonitorData
    {
        public string id;
        public string name;
        public int x;
        public int y;
        public int width;
        public int height;
        public bool primary;
        public double scale;
    }

    public static class NativeMethods
    {
        private const int MONITORINFOF_PRIMARY = 1;
        private const int MDT_EFFECTIVE_DPI = 0;

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct MONITORINFOEX
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public int dwFlags;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string szDevice;
        }

        private delegate bool MonitorEnumProc(
            IntPtr hMonitor,
            IntPtr hdcMonitor,
            IntPtr lprcMonitor,
            IntPtr dwData
        );

        [DllImport("user32.dll")]
        private static extern bool EnumDisplayMonitors(
            IntPtr hdc,
            IntPtr lprcClip,
            MonitorEnumProc callback,
            IntPtr dwData
        );

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool GetMonitorInfo(
            IntPtr hMonitor,
            ref MONITORINFOEX monitorInfo
        );

        [DllImport("Shcore.dll")]
        private static extern int GetDpiForMonitor(
            IntPtr hMonitor,
            int dpiType,
            out uint dpiX,
            out uint dpiY
        );

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool SystemParametersInfo(
            int action,
            int parameter,
            string value,
            int updateFlags
        );

        public static List<MonitorData> GetMonitors()
        {
            var result = new List<MonitorData>();
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(
                IntPtr handle,
                IntPtr hdc,
                IntPtr rect,
                IntPtr data)
            {
                var info = new MONITORINFOEX();
                info.cbSize = Marshal.SizeOf(info);
                if (!GetMonitorInfo(handle, ref info))
                    return true;

                double scale = 1.0;
                try
                {
                    uint dpiX;
                    uint dpiY;
                    if (GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, out dpiX, out dpiY) == 0)
                        scale = Math.Round(dpiX / 96.0, 2);
                }
                catch
                {
                    scale = 1.0;
                }

                result.Add(new MonitorData
                {
                    id = info.szDevice,
                    name = info.szDevice.Replace(@"\\.\", ""),
                    x = info.rcMonitor.Left,
                    y = info.rcMonitor.Top,
                    width = info.rcMonitor.Right - info.rcMonitor.Left,
                    height = info.rcMonitor.Bottom - info.rcMonitor.Top,
                    primary = (info.dwFlags & MONITORINFOF_PRIMARY) != 0,
                    scale = scale
                });
                return result.Count < 4;
            }, IntPtr.Zero);

            result.Sort(delegate(MonitorData left, MonitorData right)
            {
                int horizontal = left.x.CompareTo(right.x);
                return horizontal != 0 ? horizontal : left.y.CompareTo(right.y);
            });
            return result;
        }
    }
}
"@

function Send-Response {
    param(
        [System.IO.Stream]$Stream,
        [int]$StatusCode,
        [string]$StatusText,
        [string]$ContentType,
        [byte[]]$Body
    )

    $header = "HTTP/1.1 $StatusCode $StatusText`r`n" +
        "Content-Type: $ContentType`r`n" +
        "Content-Length: $($Body.Length)`r`n" +
        "Cache-Control: no-store`r`n" +
        "Connection: close`r`n`r`n"
    $headerBytes = [Text.Encoding]::UTF8.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
    $Stream.Flush()
}

function Send-Json {
    param(
        [System.IO.Stream]$Stream,
        [int]$StatusCode,
        [object]$Value
    )

    $statusText = if ($StatusCode -eq 200) { "OK" } else { "Internal Server Error" }
    $json = $Value | ConvertTo-Json -Depth 8 -Compress
    Send-Response $Stream $StatusCode $statusText "application/json; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes($json))
}

function Get-MimeType {
    param([string]$Path)

    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".css"  { "text/css; charset=utf-8" }
        ".js"   { "application/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".png"  { "image/png" }
        ".jpg"  { "image/jpeg" }
        ".jpeg" { "image/jpeg" }
        ".webp" { "image/webp" }
        ".svg"  { "image/svg+xml" }
        default { "application/octet-stream" }
    }
}

function Read-Request {
    param([System.IO.Stream]$Stream)

    $headerBytes = [Collections.Generic.List[byte]]::new()
    $match = 0
    while ($headerBytes.Count -lt 65536) {
        $value = $Stream.ReadByte()
        if ($value -lt 0) {
            break
        }
        $headerBytes.Add([byte]$value)
        $expected = @(13, 10, 13, 10)
        if ($value -eq $expected[$match]) {
            $match++
            if ($match -eq 4) {
                break
            }
        } else {
            $match = if ($value -eq 13) { 1 } else { 0 }
        }
    }

    $headerText = [Text.Encoding]::UTF8.GetString($headerBytes.ToArray())
    $lines = $headerText -split "`r`n"
    if (-not $lines[0]) {
        throw "Leere HTTP-Anfrage."
    }

    $requestParts = $lines[0] -split " "
    $headers = @{}
    foreach ($line in $lines[1..($lines.Length - 1)]) {
        $separator = $line.IndexOf(":")
        if ($separator -gt 0) {
            $headers[$line.Substring(0, $separator).Trim()] = $line.Substring($separator + 1).Trim()
        }
    }

    $contentLength = 0
    if ($headers.ContainsKey("Content-Length")) {
        $contentLength = [int]$headers["Content-Length"]
    }
    if ($contentLength -gt 104857600) {
        throw "Die Bilddatei ist größer als 100 MB."
    }

    $body = [byte[]]::new($contentLength)
    $offset = 0
    while ($offset -lt $contentLength) {
        $read = $Stream.Read($body, $offset, $contentLength - $offset)
        if ($read -le 0) {
            throw "Die Anfrage wurde vorzeitig beendet."
        }
        $offset += $read
    }

    return @{
        Method = $requestParts[0]
        Path = $requestParts[1]
        Headers = $headers
        Body = $body
    }
}

function Set-MonitorCanvasWallpaper {
    param([byte[]]$PngBytes)

    if ($PngBytes.Length -lt 8 -or
        $PngBytes[0] -ne 137 -or
        $PngBytes[1] -ne 80 -or
        $PngBytes[2] -ne 78 -or
        $PngBytes[3] -ne 71) {
        throw "Es wurde keine gültige PNG-Datei empfangen."
    }

    [IO.Directory]::CreateDirectory($DataDirectory) | Out-Null
    $wallpaperPath = Join-Path $DataDirectory ("monitor-canvas-wallpaper-{0}.png" -f ([DateTimeOffset]::Now.ToUnixTimeMilliseconds()))
    [IO.File]::WriteAllBytes($wallpaperPath, $PngBytes)
    Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name "WallpaperStyle" -Value "22"
    Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name "TileWallpaper" -Value "0"

    $success = [MonitorCanvas.NativeMethods]::SystemParametersInfo(20, 0, $wallpaperPath, 3)
    if (-not $success) {
        throw "Windows konnte das Hintergrundbild nicht übernehmen."
    }

    Get-ChildItem -Path $DataDirectory -Filter "monitor-canvas-wallpaper-*.png" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 8 |
        Remove-Item -Force -ErrorAction SilentlyContinue

    return $wallpaperPath
}

function Handle-Request {
    param(
        [System.IO.Stream]$Stream,
        [hashtable]$Request
    )

    $requestPath = ($Request.Path -split "\?")[0]

    if ($Request.Method -eq "GET" -and $requestPath -eq "/api/monitors") {
        $monitors = [MonitorCanvas.NativeMethods]::GetMonitors()
        Send-Json $Stream 200 @{ monitors = $monitors }
        return
    }

    if ($Request.Method -eq "POST" -and $requestPath -eq "/api/wallpaper") {
        $wallpaperPath = Set-MonitorCanvasWallpaper $Request.Body
        Send-Json $Stream 200 @{ ok = $true; path = $wallpaperPath }
        return
    }

    if ($Request.Method -ne "GET") {
        Send-Response $Stream 404 "Not Found" "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Nicht gefunden"))
        return
    }

    $relativePath = [Uri]::UnescapeDataString($requestPath.TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($relativePath)) {
        $relativePath = "index.html"
    }

    $rootFullPath = [IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
    $filePath = [IO.Path]::GetFullPath((Join-Path $Root $relativePath))
    if (-not $filePath.StartsWith($rootFullPath, [StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.File]::Exists($filePath)) {
        Send-Response $Stream 404 "Not Found" "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Nicht gefunden"))
        return
    }

    $content = [IO.File]::ReadAllBytes($filePath)
    Send-Response $Stream 200 "OK" (Get-MimeType $filePath) $content
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listenerStarted = $false

try {
    $address = "http://127.0.0.1:$Port"
    try {
        $listener.Start()
        $listenerStarted = $true
    } catch [Net.Sockets.SocketException] {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$address/api/monitors" -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                Write-Host ""
                Write-Host "MonitorCanvas läuft bereits." -ForegroundColor Green
                Write-Host "Die vorhandene Anwendung wird geöffnet."
                if (-not $NoBrowser) {
                    Start-Process $address
                }
                Start-Sleep -Seconds 1
                exit 0
            }
        } catch {
            throw "Der Anschluss $Port wird bereits von einem anderen Programm verwendet. Bitte dieses Programm schließen und MonitorCanvas erneut starten."
        }
    }

    Write-Host ""
    Write-Host "MonitorCanvas ist bereit:" -ForegroundColor Green
    Write-Host $address -ForegroundColor Cyan
    Write-Host "Dieses Fenster offen lassen. Zum Beenden Strg+C drücken."
    Write-Host ""

    if (-not $NoBrowser) {
        Start-Process $address
    }

    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            try {
                $request = Read-Request $stream
                Handle-Request $stream $request
            } catch {
                try {
                    Send-Json $stream 500 @{ error = $_.Exception.Message }
                } catch {
                    # Der Browser hat die Verbindung bereits geschlossen.
                }
            } finally {
                $stream.Dispose()
            }
        } finally {
            $client.Dispose()
        }
    }
} finally {
    if ($listenerStarted) {
        $listener.Stop()
    }
}
