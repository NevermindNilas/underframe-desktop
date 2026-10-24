# Windows OCR helper: recognises the text in one image with Windows.Media.Ocr and prints JSON on stdout.
#
# Usage: powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File windows-ocr.ps1 [-Language <tag>] <image> [<image> ...]
# Output for one image: {"lines":[{"text":..,"words":[{"text":..,"x":..,"y":..,"w":..,"h":..}]}],"width":..,"height":..,"language":..}
# For several images: {"language":..,"images":[{"lines":..,"width":..,"height":..}, ...]} in argument order.
# Errors: {"error":"<code>","message":".."} on stdout with exit code 2 (expected failures) or 1 (unexpected).
# Runs on Windows PowerShell 5.1, which can load WinRT types directly.

[CmdletBinding(PositionalBinding = $false)]
param(
  [string]$Language = '',
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)][string[]]$ImagePath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Write-Result($obj, [int]$code) {
  [Console]::Out.Write(($obj | ConvertTo-Json -Depth 6 -Compress))
  exit $code
}

function Fail([string]$code, [string]$message, [int]$exit = 2) {
  Write-Result ([ordered]@{ error = $code; message = $message }) $exit
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
} catch {
  Fail 'ocr-unavailable' "Windows OCR (Windows.Media.Ocr) is not available on this system: $($_.Exception.Message)"
}

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $null = $task.Wait(-1)
  $task.Result
}

# Pick the engine.
# - With -Language (the app passes en-US, because mod names are matched in English): that language, else another
#   installed Latin-script recognizer (de-DE reads "Serration" fine), else fail with 'no-ocr-language'. A CJK or
#   Cyrillic recognizer would misread English names, so it is never used for an explicit Latin language.
# - Without -Language: the user's profile languages, else en-US.
$engine = $null
if ($Language) {
  try {
    $lang = New-Object Windows.Globalization.Language $Language
    if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang) }
  } catch {}
  if (-not $engine) {
    $latin = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.Script -eq 'Latn' } | Select-Object -First 1
    if ($latin) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($latin) }
  }
  if (-not $engine) {
    Fail 'no-ocr-language' "Windows OCR has no English (or other Latin-script) recognition language installed. Add English (United States) in Settings > Time & language > Language & region, including its optical character recognition feature."
  }
} else {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) {
    try {
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US'))
    } catch {}
  }
  if (-not $engine) {
    Fail 'no-ocr-language' 'Windows OCR has no recognition language installed. Add an OCR language pack such as English (United States) in Settings > Time & language > Language & region.'
  }
}

function Recognize-Image([string]$path) {
  $stream = $null
  try {
    $full = [System.IO.Path]::GetFullPath($path)
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  } catch {
    if ($stream) { $stream.Dispose() }
    Fail 'bad-image' "The image could not be read: $($_.Exception.Message)"
  }

  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  if ($decoder.PixelWidth -gt $max -or $decoder.PixelHeight -gt $max) {
    $stream.Dispose()
    Fail 'image-too-large' "The image is $($decoder.PixelWidth)x$($decoder.PixelHeight); Windows OCR accepts at most $max pixels per side."
  }

  try {
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  } catch {
    Fail 'ocr-failed' "Windows OCR failed: $($_.Exception.Message)" 1
  } finally {
    if ($stream) { $stream.Dispose() }
  }

  $lines = New-Object System.Collections.ArrayList
  foreach ($line in $result.Lines) {
    $words = New-Object System.Collections.ArrayList
    foreach ($word in $line.Words) {
      $r = $word.BoundingRect
      $null = $words.Add([ordered]@{
          text = $word.Text
          x    = [math]::Round($r.X, 1)
          y    = [math]::Round($r.Y, 1)
          w    = [math]::Round($r.Width, 1)
          h    = [math]::Round($r.Height, 1)
        })
    }
    $null = $lines.Add([ordered]@{ text = $line.Text; words = $words })
  }
  [ordered]@{ lines = $lines; width = [int]$decoder.PixelWidth; height = [int]$decoder.PixelHeight }
}

$language = $engine.RecognizerLanguage.LanguageTag
if ($ImagePath.Count -eq 1) {
  $one = Recognize-Image $ImagePath[0]
  Write-Result ([ordered]@{ lines = $one.lines; width = $one.width; height = $one.height; language = $language }) 0
}
$images = New-Object System.Collections.ArrayList
foreach ($p in $ImagePath) { $null = $images.Add((Recognize-Image $p)) }
Write-Result ([ordered]@{ language = $language; images = $images }) 0
