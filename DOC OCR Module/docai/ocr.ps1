# Windows built-in OCR (no install, nothing leaves this PC). Reads $env:CM_OCR_PATH (PDF or image) and prints
# a JSON array with one string per page. Run through -EncodedCommand by readers.py, so no script file executes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTaskOp = $methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asTaskAct = $methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function Wait-Op($op, [type]$t) { $task = $asTaskOp.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function Wait-Act($a) { $task = $asTaskAct.Invoke($null, @($a)); $task.Wait(-1) | Out-Null }

$ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
if (-not $ocr) { throw 'Windows OCR (English) is not available on this PC.' }
$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension

function Read-Bitmap($decoder) {
    $w = $decoder.PixelWidth; $h = $decoder.PixelHeight
    $scale = [Math]::Min(1.0, $max / [Math]::Max($w, $h))
    $tf = [Windows.Graphics.Imaging.BitmapTransform]::new()
    $tf.ScaledWidth = [uint32][Math]::Floor($w * $scale); $tf.ScaledHeight = [uint32][Math]::Floor($h * $scale)
    $op = $decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
        $tf, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)
    Wait-Op $op ([Windows.Graphics.Imaging.SoftwareBitmap])
}
function Read-Text($bitmap) {
    $r = Wait-Op ($ocr.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    (($r.Lines | ForEach-Object { $_.Text }) -join "`n")
}

$path = $env:CM_OCR_PATH
$maxPages = [int]$(if ($env:CM_OCR_MAXPAGES) { $env:CM_OCR_MAXPAGES } else { 10 })
$file = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$pages = New-Object System.Collections.Generic.List[string]
if ($path -match '\.pdf$') {
    $pdf = Wait-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
    for ($i = 0; $i -lt [Math]::Min($pdf.PageCount, $maxPages); $i++) {
        $page = $pdf.GetPage($i)
        $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
        $opts = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
        $opts.DestinationWidth = [uint32][Math]::Min(2000, $max)   # ~240 dpi on A4
        Wait-Act ($page.RenderToStreamAsync($stream, $opts))
        $dec = Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bmp = Read-Bitmap $dec
        $pages.Add((Read-Text $bmp))
        $bmp.Dispose(); $stream.Dispose(); $page.Dispose()
    }
} else {
    $stream = Wait-Op ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $dec = Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = Read-Bitmap $dec
    $pages.Add((Read-Text $bmp))
    $bmp.Dispose(); $stream.Dispose()
}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
ConvertTo-Json -InputObject @($pages) -Compress
