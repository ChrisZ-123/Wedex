$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskOutput=Join-Path $taskRoot 'public'
function Fill-RoundedRectangle($Graphics,$Brush,[single]$X,[single]$Y,[single]$Width,[single]$Height,[single]$Radius){
 $taskPath=[Drawing.Drawing2D.GraphicsPath]::new()
 $taskD=2*$Radius
 $taskPath.AddArc($X,$Y,$taskD,$taskD,180,90)
 $taskPath.AddArc(($X+$Width-$taskD),$Y,$taskD,$taskD,270,90)
 $taskPath.AddArc(($X+$Width-$taskD),($Y+$Height-$taskD),$taskD,$taskD,0,90)
 $taskPath.AddArc($X,($Y+$Height-$taskD),$taskD,$taskD,90,90)
 $taskPath.CloseFigure()
 $Graphics.FillPath($Brush,$taskPath)
 $taskPath.Dispose()
}
$taskImages=@()
foreach($taskSize in @(16,20,24,32,48,64,128,256)){
 $taskBitmap=[Drawing.Bitmap]::new($taskSize,$taskSize,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
 $taskGraphics=[Drawing.Graphics]::FromImage($taskBitmap)
 $taskGraphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
 $taskGraphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::HighQuality
 $taskGraphics.Clear([Drawing.Color]::Transparent)
 $taskScale=[single]($taskSize/64.0)
 $taskGraphics.ScaleTransform($taskScale,$taskScale)
 $taskGreen=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(23,158,115))
 $taskWhite=[Drawing.SolidBrush]::new([Drawing.Color]::White)
 $taskMint=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(203,247,229))
 Fill-RoundedRectangle $taskGraphics $taskGreen 2 2 60 60 14
 Fill-RoundedRectangle $taskGraphics $taskMint 28 29 27 22 8
 $taskGraphics.FillPolygon($taskMint,[Drawing.PointF[]]@([Drawing.PointF]::new(44,47),[Drawing.PointF]::new(53,54),[Drawing.PointF]::new(51,43)))
 Fill-RoundedRectangle $taskGraphics $taskWhite 10 12 38 29 11
 $taskGraphics.FillPolygon($taskWhite,[Drawing.PointF[]]@([Drawing.PointF]::new(17,35),[Drawing.PointF]::new(15,46),[Drawing.PointF]::new(28,38)))
 foreach($taskX in @(19,27,35)){$taskGraphics.FillEllipse($taskGreen,$taskX,24,4,4)}
 $taskStream=[IO.MemoryStream]::new()
 $taskBitmap.Save($taskStream,[Drawing.Imaging.ImageFormat]::Png)
 $taskImages+=,[PSCustomObject]@{Size=$taskSize;Bytes=$taskStream.ToArray()}
 if($taskSize -eq 256){[IO.File]::WriteAllBytes((Join-Path $taskOutput 'launcher.png'),$taskStream.ToArray())}
 $taskStream.Dispose();$taskGraphics.Dispose();$taskBitmap.Dispose();$taskGreen.Dispose();$taskWhite.Dispose();$taskMint.Dispose()
}
$taskIconStream=[IO.MemoryStream]::new()
$taskWriter=[IO.BinaryWriter]::new($taskIconStream)
$taskWriter.Write([uint16]0);$taskWriter.Write([uint16]1);$taskWriter.Write([uint16]$taskImages.Count)
$taskOffset=6+16*$taskImages.Count
foreach($taskImage in $taskImages){
 $taskDimension=if($taskImage.Size -eq 256){0}else{$taskImage.Size}
 $taskWriter.Write([byte]$taskDimension);$taskWriter.Write([byte]$taskDimension);$taskWriter.Write([byte]0);$taskWriter.Write([byte]0)
 $taskWriter.Write([uint16]1);$taskWriter.Write([uint16]32);$taskWriter.Write([uint32]$taskImage.Bytes.Length);$taskWriter.Write([uint32]$taskOffset)
 $taskOffset+=$taskImage.Bytes.Length
}
foreach($taskImage in $taskImages){$taskWriter.Write([byte[]]$taskImage.Bytes)}
$taskWriter.Flush();[IO.File]::WriteAllBytes((Join-Path $taskOutput 'launcher.ico'),$taskIconStream.ToArray())
$taskWriter.Dispose();$taskIconStream.Dispose()
Write-Output 'Wedex chat icon generated: 16/20/24/32/48/64/128/256 pixels'
