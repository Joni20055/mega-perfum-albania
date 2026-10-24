$ErrorActionPreference = "Stop"

$Backend = $PSScriptRoot
$Root = Split-Path -Parent $Backend
$Frontend = Join-Path $Root "frontend"
$DataDir = Join-Path $Backend "data"
$ProductsFile = Join-Path $Backend "products.json"
$StockFile = Join-Path $DataDir "stock.json"
$OrdersFile = Join-Path $DataDir "orders.json"
$MessagesFile = Join-Path $DataDir "messages.json"
$AdminCode = "MEGA4826"
$script:AdminSessions = @{}
$Utf8 = New-Object System.Text.UTF8Encoding $false

function Read-Text([string]$Path) {
  $text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($Path))
  if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) { return $text.Substring(1) }
  return $text
}

function Read-JsonFile([string]$Path) {
  return (Read-Text $Path | ConvertFrom-Json)
}

function Read-JsonArray([string]$Path) {
  if (-not (Test-Path $Path)) { return ,@() }
  $text = (Read-Text $Path).Trim()
  if ([string]::IsNullOrWhiteSpace($text) -or $text -eq "[]") { return ,@() }
  return ,@(ConvertFrom-Json $text)
}

function Write-JsonFile([string]$Path, $Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 8
  [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $Utf8)
}

function Write-EmptyArray([string]$Path) {
  [System.IO.File]::WriteAllText($Path, "[]" + [Environment]::NewLine, $Utf8)
}

function Clean([object]$Value, [int]$Max) {
  $text = [regex]::Replace([string]$Value, "\s+", " ").Trim()
  if ($text.Length -gt $Max) { return $text.Substring(0, $Max) }
  return $text
}

function Test-Phone([string]$Phone) {
  $digits = [regex]::Replace($Phone, "\D", "")
  return ($digits.Length -ge 8 -and $digits.Length -le 15)
}

function Parse-Qty($Qty) {
  $number = 0.0
  $ok = [double]::TryParse([string]$Qty, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)
  if (-not $ok) { return $null }
  $rounded = [math]::Round($number)
  if ([math]::Abs($number - $rounded) -gt 0.00001) { return $null }
  $n = [int]$rounded
  if ($n -lt 1 -or $n -gt 10) { return $null }
  return $n
}

function New-OrderId([string]$Prefix) {
  $stamp = (Get-Date).ToString("yyyyMMddHHmmss")
  $rand = Get-Random -Minimum 1000 -Maximum 9999
  return "$Prefix-$stamp-$rand"
}

function Get-PaypalLink {
  $link = [string]$env:PAYPAL_LINK
  if ([string]::IsNullOrWhiteSpace($link)) { return "" }
  try {
    $uri = [Uri]$link
    if ($uri.Scheme -eq "https") { return $uri.AbsoluteUri }
  } catch {
    return ""
  }
  return ""
}

function Find-Product([string]$Id) {
  foreach ($product in $script:Products) {
    if ([string]$product.id -eq $Id) { return $product }
  }
  return $null
}

function Ensure-Data {
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  if (-not (Test-Path $StockFile)) {
    $stock = [ordered]@{}
    foreach ($product in $script:Products) { $stock[[string]$product.id] = [int]$product.stock }
    Write-JsonFile $StockFile ([pscustomobject]$stock)
  } else {
    $stock = Read-JsonFile $StockFile
    $changed = $false
    foreach ($product in $script:Products) {
      $id = [string]$product.id
      $prop = $stock.PSObject.Properties[$id]
      if (-not $prop -or [int]$prop.Value -lt 0) {
        $stock | Add-Member -NotePropertyName $id -NotePropertyValue ([int]$product.stock) -Force
        $changed = $true
      }
    }
    if ($changed) { Write-JsonFile $StockFile $stock }
  }
  if (-not (Test-Path $OrdersFile)) { Write-EmptyArray $OrdersFile }
  if (-not (Test-Path $MessagesFile)) { Write-EmptyArray $MessagesFile }
}

function Get-StockCount($Stock, [string]$Id) {
  $prop = $Stock.PSObject.Properties[$Id]
  if (-not $prop) { return 0 }
  return [int]$prop.Value
}

function Get-Catalog {
  $stock = Read-JsonFile $StockFile
  $result = foreach ($product in $script:Products) {
    $id = [string]$product.id
    [pscustomobject]@{
      id = $product.id
      brand = $product.brand
      name = $product.name
      concentration = $product.concentration
      size = $product.size
      audience = $product.audience
      accords = @($product.accords)
      nuance = $product.nuance
      popularityLabel = $product.popularityLabel
      popularity = $product.popularity
      price = [int]$product.price
      oldPrice = [int]$product.oldPrice
      stock = (Get-StockCount $stock $id)
      image = $product.image
    }
  }
  return ,@($result)
}

function Send-Bytes($Response, [int]$Status, [byte[]]$Bytes, [string]$ContentType) {
  $Response.StatusCode = $Status
  $Response.ContentType = $ContentType
  $Response.ContentLength64 = $Bytes.Length
  $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
  $Response.Close()
}

function Send-Json($Response, [int]$Status, $Value) {
  $culture = [System.Threading.Thread]::CurrentThread.CurrentCulture
  [System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture
  try {
    $json = ConvertTo-Json -InputObject $Value -Depth 8 -Compress
  } finally {
    [System.Threading.Thread]::CurrentThread.CurrentCulture = $culture
  }
  Send-Bytes $Response $Status ([System.Text.Encoding]::UTF8.GetBytes($json)) "application/json; charset=utf-8"
}

function Round-Money([double]$Value) {
  return [math]::Round($Value, 2, [MidpointRounding]::AwayFromZero)
}

$script:EurQuote = $null
$script:EurQuoteAt = [datetime]::MinValue

function Get-EurQuote {
  return [pscustomobject]@{
    lekPerEur = 85
    updated = "1 euro = 85 lek"
  }
}

function Handle-Rate($Response) {
  $quote = Get-EurQuote
  if ($null -eq $quote) {
    Send-Error $Response 503 "Kursi euro nuk u lexua. Provo përsëri."
    return
  }
  Send-Json $Response 200 @{
    lekPerEur = $quote.lekPerEur
    updated = $quote.updated
  }
}

function Send-Error($Response, [int]$Status, [string]$Message) {
  Send-Json $Response $Status @{ error = $Message }
}

function Read-Body($Request) {
  if ($Request.ContentLength64 -gt 102400) { return "TOO_LARGE" }
  $reader = New-Object System.IO.StreamReader($Request.InputStream, [System.Text.Encoding]::UTF8)
  try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  return ($text | ConvertFrom-Json)
}

function Handle-Order($Response, $Body) {
  $method = [string]$Body.paymentMethod
  if ($method -ne "paypal" -and $method -ne "cash") {
    Send-Error $Response 400 "Zgjidhni PayPal ose cash."
    return
  }

  $incoming = @($Body.items)
  if ($incoming.Count -lt 1 -or $incoming.Count -gt 20 -or $null -eq $Body.items) {
    Send-Error $Response 400 "Porosia nuk është e vlefshme."
    return
  }

  $merged = @{}
  foreach ($item in $incoming) {
    if ($null -eq $item) { continue }
    $qty = Parse-Qty $item.qty
    $id = [string]$item.id
    if ([string]::IsNullOrWhiteSpace($id) -or $null -eq $qty) {
      Send-Error $Response 400 "Sasia nuk është e vlefshme."
      return
    }
    if ($merged.ContainsKey($id)) { $merged[$id] += $qty } else { $merged[$id] = $qty }
    if ($merged[$id] -gt 10) {
      Send-Error $Response 400 "Sasia nuk është e vlefshme."
      return
    }
  }
  if ($merged.Count -lt 1) {
    Send-Error $Response 400 "Porosia nuk është e vlefshme."
    return
  }

  $customer = $null
  if ($method -eq "cash") {
    $person = $Body.customer
    $name = Clean $(if ($person) { $person.name } else { "" }) 80
    $phone = Clean $(if ($person) { $person.phone } else { "" }) 30
    $email = Clean $(if ($person) { $person.email } else { "" }) 120
    if ($name.Length -lt 2 -or $name -notmatch "\p{L}") {
      Send-Error $Response 400 "Shkruani emrin."
      return
    }
    if ($email -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
      Send-Error $Response 400 "Shkruani një email të vlefshëm."
      return
    }
    if (-not (Test-Phone $phone)) {
      Send-Error $Response 400 "Shkruani një numër telefoni të vlefshëm."
      return
    }
    $country = Clean $(if ($person) { $person.country } else { "" }) 20
    $city = Clean $(if ($person) { $person.city } else { "" }) 60
    if ($country -ne "Kosovë" -and $country -ne "Shqipëri") {
      Send-Error $Response 400 "Zgjidhni Kosovën ose Shqipërinë."
      return
    }
    if ($city.Length -lt 2 -or $city -notmatch "\p{L}") {
      Send-Error $Response 400 "Zgjidhni qytetin ku ndodheni."
      return
    }
    $customer = [pscustomobject]@{
      name = $name
      phone = $phone
      email = $email
      country = $country
      city = $city
    }
  }

  $stock = Read-JsonFile $StockFile
  $items = New-Object System.Collections.Generic.List[object]
  foreach ($id in @($merged.Keys)) {
    $product = Find-Product $id
    if (-not $product) {
      Send-Error $Response 400 "Produkti nuk është i vlefshëm."
      return
    }
    $qty = [int]$merged[$id]
    $left = Get-StockCount $stock $id
    if ($left -lt $qty) {
      $label = "$($product.brand) $($product.name)"
      if ($left -lt 1) { Send-Error $Response 409 "$label ka mbaruar." }
      else { Send-Error $Response 409 "Ka vetëm $left copë për $label." }
      return
    }
    $items.Add([pscustomobject]@{
      id = $product.id
      name = "$($product.brand) $($product.name)"
      concentration = $product.concentration
      size = $product.size
      qty = $qty
      price = [int]$product.price
    })
  }

  $subtotal = 0
  foreach ($item in $items) { $subtotal += [int]$item.price * [int]$item.qty }
  $total = $subtotal
  $shipping = $null
  $lekPerEur = $null
  $rateUpdated = $null
  $subtotalEur = $null
  $totalEur = $null
  if ($method -eq "cash" -and $null -ne $customer) {
    if ($customer.country -eq "Kosovë") {
      $quote = Get-EurQuote
      if ($null -eq $quote) {
        Send-Error $Response 503 "Kursi euro nuk u lexua. Provo përsëri."
        return
      }
      $lekPerEur = [double]$quote.lekPerEur
      $subtotalEur = Round-Money ($subtotal / $lekPerEur)
      $shipping = [pscustomobject]@{ amount = 5; currency = "EUR" }
      $totalEur = Round-Money ($subtotalEur + [double]$shipping.amount)
      $rateUpdated = [string]$quote.updated
    } else {
      $shipping = [pscustomobject]@{ amount = 300; currency = "ALL" }
      $total = $subtotal + 300
    }
  }

  foreach ($item in $items) {
    $id = [string]$item.id
    $stock | Add-Member -NotePropertyName $id -NotePropertyValue ((Get-StockCount $stock $id) - [int]$item.qty) -Force
  }
  $status = "aktive"
  if ($method -eq "paypal") { $status = "pret pagesën" }
  $order = [pscustomobject]@{
    id = (New-OrderId "PF")
    items = $items.ToArray()
    subtotal = $subtotal
    shipping = $shipping
    lekPerEur = $lekPerEur
    rateUpdated = $rateUpdated
    subtotalEur = $subtotalEur
    totalEur = $totalEur
    total = $total
    paymentMethod = $method
    customer = $customer
    status = $status
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
  }

  $existing = Read-JsonArray $OrdersFile
  $all = New-Object System.Collections.Generic.List[object]
  foreach ($old in @($existing)) { if ($null -ne $old) { $all.Add($old) } }
  $all.Add($order)
  Write-JsonFile $StockFile $stock
  Write-JsonFile $OrdersFile ($all.ToArray())

  $paypalLink = ""
  if ($method -eq "paypal") { $paypalLink = Get-PaypalLink }
  $payload = [pscustomobject]@{
    ok = $true
    order = [pscustomobject]@{
      id = $order.id
      items = $order.items
      subtotal = $order.subtotal
      shipping = $order.shipping
      lekPerEur = $order.lekPerEur
      rateUpdated = $order.rateUpdated
      subtotalEur = $order.subtotalEur
      totalEur = $order.totalEur
      total = $order.total
      paymentMethod = $order.paymentMethod
      customer = $order.customer
      status = $order.status
      createdAt = $order.createdAt
      paypalLink = $paypalLink
    }
  }
  Send-Json $Response 200 $payload
}

function Handle-Contact($Response, $Body) {
  $name = Clean $Body.name 80
  $email = Clean $Body.email 120
  $phone = Clean $Body.phone 30
  $message = Clean $Body.message 1000
  if ($name.Length -lt 2 -or $name -notmatch "\p{L}") {
    Send-Error $Response 400 "Shkruani emrin."
    return
  }
  if ($email -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
    Send-Error $Response 400 "Shkruani një email të vlefshëm."
    return
  }
  if (-not [string]::IsNullOrWhiteSpace($phone) -and -not (Test-Phone $phone)) {
    Send-Error $Response 400 "Shkruani një numër telefoni të vlefshëm."
    return
  }
  if ($message.Length -lt 5) {
    Send-Error $Response 400 "Shkruani një mesazh."
    return
  }

  $entry = [pscustomobject]@{
    id = (New-OrderId "MS")
    name = $name
    email = $email
    phone = $phone
    message = $message
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $existing = Read-JsonArray $MessagesFile
  $all = New-Object System.Collections.Generic.List[object]
  foreach ($old in @($existing)) { if ($null -ne $old) { $all.Add($old) } }
  $all.Add($entry)
  Write-JsonFile $MessagesFile ($all.ToArray())
  Send-Json $Response 200 @{ ok = $true }
}

function Get-ContentType([string]$Path) {
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".js" { return "text/javascript; charset=utf-8" }
    ".svg" { return "image/svg+xml" }
    ".jpg" { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".png" { return "image/png" }
    ".webp" { return "image/webp" }
    ".ico" { return "image/x-icon" }
    default { return "application/octet-stream" }
  }
}

function Send-Static($Response, [string]$UrlPath) {
  $relative = [Uri]::UnescapeDataString($UrlPath)
  if ([string]::IsNullOrWhiteSpace($relative) -or $relative -eq "/") { $relative = "/index.html" }
  $relative = $relative.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  $full = [System.IO.Path]::GetFullPath((Join-Path $Frontend $relative))
  $root = [System.IO.Path]::GetFullPath($Frontend)
  if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $root = $root + [System.IO.Path]::DirectorySeparatorChar
  }
  if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("Nuk u gjet.")
    Send-Bytes $Response 404 $bytes "text/plain; charset=utf-8"
    return
  }
  $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
  if ($ext -in @(".html", ".js", ".css")) { $Response.Headers["Cache-Control"] = "no-cache" }
  Send-Bytes $Response 200 ([System.IO.File]::ReadAllBytes($full)) (Get-ContentType $full)
}

function Get-AdminToken($Request) {
  return ([string]$Request.Headers["X-Admin-Token"]).Trim()
}

function Test-Admin($Request) {
  $token = Get-AdminToken $Request
  if ([string]::IsNullOrWhiteSpace($token)) { return $false }
  return $script:AdminSessions.ContainsKey($token)
}

function New-AdminToken {
  $token = [guid]::NewGuid().ToString("N")
  $script:AdminSessions[$token] = (Get-Date).ToUniversalTime().ToString("o")
  return $token
}

function Handle-AdminLogin($Response, $Body) {
  $code = Clean $Body.code 40
  if ($code -ne $AdminCode) {
    Send-Error $Response 401 "Kodi nuk është i saktë."
    return
  }
  Send-Json $Response 200 @{ ok = $true; token = (New-AdminToken) }
}

function Handle-AdminLogout($Request, $Response) {
  $token = Get-AdminToken $Request
  if (-not [string]::IsNullOrWhiteSpace($token) -and $script:AdminSessions.ContainsKey($token)) {
    $script:AdminSessions.Remove($token) | Out-Null
  }
  Send-Json $Response 200 @{ ok = $true }
}

function Sort-Newest($Items) {
  return @($Items | Sort-Object { [string]$_.createdAt } -Descending)
}

function Handle-AdminInbox($Response) {
  $orders = Sort-Newest (Read-JsonArray $OrdersFile)
  $messages = Sort-Newest (Read-JsonArray $MessagesFile)
  Send-Json $Response 200 ([pscustomobject]@{
    orders = @($orders)
    messages = @($messages)
  })
}

function Handle-Request($Context) {
  $request = $Context.Request
  $response = $Context.Response
  $path = $request.Url.AbsolutePath
  try {
    if ($path -eq "/api/products" -and $request.HttpMethod -eq "GET") {
      Send-Json $response 200 (Get-Catalog)
      return
    }
    if ($path -eq "/api/rate" -and $request.HttpMethod -eq "GET") {
      Handle-Rate $response
      return
    }
    if ($path -eq "/api/orders" -and $request.HttpMethod -eq "POST") {
      $body = Read-Body $request
      if ($body -eq "TOO_LARGE" -or $null -eq $body) {
        Send-Error $response 400 "Kërkesa nuk u lexua."
        return
      }
      Handle-Order $response $body
      return
    }
    if ($path -eq "/api/contact" -and $request.HttpMethod -eq "POST") {
      $body = Read-Body $request
      if ($body -eq "TOO_LARGE" -or $null -eq $body) {
        Send-Error $response 400 "Kërkesa nuk u lexua."
        return
      }
      Handle-Contact $response $body
      return
    }
    if ($path -eq "/api/admin/login" -and $request.HttpMethod -eq "POST") {
      $body = Read-Body $request
      if ($body -eq "TOO_LARGE" -or $null -eq $body) {
        Send-Error $response 400 "Kodi nuk u lexua."
        return
      }
      Handle-AdminLogin $response $body
      return
    }
    if ($path -eq "/api/admin/logout" -and $request.HttpMethod -eq "POST") {
      Handle-AdminLogout $request $response
      return
    }
    if ($path -eq "/api/admin/inbox" -and $request.HttpMethod -eq "GET") {
      if (-not (Test-Admin $request)) {
        Send-Error $response 401 "Hyrja nuk është e vlefshme."
        return
      }
      Handle-AdminInbox $response
      return
    }
    if ($path -eq "/admin" -or $path -eq "/admin/") {
      Send-Static $response "/admin.html"
      return
    }
    if ($path.StartsWith("/api")) {
      Send-Error $response 404 "Nuk u gjet."
      return
    }
    if ($request.HttpMethod -ne "GET" -and $request.HttpMethod -ne "HEAD") {
      Send-Error $response 405 "Nuk u gjet."
      return
    }
    Send-Static $response $path
  } catch {
    Write-Host ("Gabim: " + $_.Exception.Message)
    try { Send-Error $response 500 "Gabim i brendshëm." } catch { }
  }
}

function Start-ShopListener {
  foreach ($port in @(3000, 3010, 8080)) {
    foreach ($hosts in @(@("127.0.0.1", "localhost"), @("127.0.0.1"), @("localhost"))) {
      $listener = New-Object System.Net.HttpListener
      foreach ($hostName in $hosts) { $listener.Prefixes.Add("http://${hostName}:$port/") }
      try {
        $listener.Start()
        return @{ Listener = $listener; Port = $port }
      } catch {
        $listener.Close()
      }
    }
  }
  return $null
}

$script:Products = @(Read-JsonFile $ProductsFile)
Ensure-Data
$started = Start-ShopListener
if (-not $started) {
  Write-Host "Nuk u hap serveri. Portet 3000, 3010 dhe 8080 jane te zena ose te bllokuara."
  exit 1
}

$listener = $started.Listener
$port = $started.Port
Write-Host "Parfume eshte hapur te http://localhost:$port"
Write-Host "Mbylleni kete dritare per ta ndalur serverin."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    Handle-Request $context
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
