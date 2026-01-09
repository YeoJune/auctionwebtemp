# Elasticsearch Quick Setup Script for Windows PowerShell

Write-Host "🔍 Elasticsearch Integration Setup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if Docker is running
Write-Host "Step 1: Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Docker is installed: $dockerVersion" -ForegroundColor Green
    } else {
        Write-Host "✗ Docker is not available" -ForegroundColor Red
        Write-Host "  Please install Docker Desktop: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "✗ Docker is not available" -ForegroundColor Red
    Write-Host "  Please install Docker Desktop: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Step 2: Check if Elasticsearch container exists
Write-Host "Step 2: Checking Elasticsearch container..." -ForegroundColor Yellow
$esContainer = docker ps -a --filter "name=elasticsearch" --format "{{.Names}}" 2>&1

if ($esContainer -eq "elasticsearch") {
    Write-Host "→ Elasticsearch container already exists" -ForegroundColor Blue
    
    $esStatus = docker ps --filter "name=elasticsearch" --format "{{.Names}}" 2>&1
    if ($esStatus -eq "elasticsearch") {
        Write-Host "✓ Elasticsearch is running" -ForegroundColor Green
    } else {
        Write-Host "→ Starting existing Elasticsearch container..." -ForegroundColor Yellow
        docker start elasticsearch
        Write-Host "✓ Elasticsearch started" -ForegroundColor Green
    }
} else {
    Write-Host "→ Creating new Elasticsearch container..." -ForegroundColor Yellow
    docker run -d `
        --name elasticsearch `
        -p 9200:9200 `
        -p 9300:9300 `
        -e "discovery.type=single-node" `
        -e "xpack.security.enabled=false" `
        docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    
    Write-Host "✓ Elasticsearch container created" -ForegroundColor Green
    Write-Host "→ Waiting for Elasticsearch to start (30 seconds)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 30
}

Write-Host ""

# Step 3: Test Elasticsearch connection
Write-Host "Step 3: Testing Elasticsearch connection..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://localhost:9200" -Method Get -TimeoutSec 10
    Write-Host "✓ Elasticsearch is responding" -ForegroundColor Green
    Write-Host "  Version: $($response.version.number)" -ForegroundColor Gray
    Write-Host "  Cluster: $($response.cluster_name)" -ForegroundColor Gray
} catch {
    Write-Host "✗ Cannot connect to Elasticsearch" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    Write-Host "  Please wait a moment and try again" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Step 4: Install Node.js dependencies
Write-Host "Step 4: Installing Node.js dependencies..." -ForegroundColor Yellow
if (Test-Path "package.json") {
    npm install @elastic/elasticsearch
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✗ package.json not found" -ForegroundColor Red
    Write-Host "  Please run this script from the project root directory" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Step 5: Check .env file
Write-Host "Step 5: Checking .env configuration..." -ForegroundColor Yellow
if (Test-Path ".env") {
    $envContent = Get-Content ".env" -Raw
    if ($envContent -match "ELASTICSEARCH_URL") {
        Write-Host "✓ ELASTICSEARCH_URL is already configured" -ForegroundColor Green
    } else {
        Write-Host "→ Adding ELASTICSEARCH_URL to .env..." -ForegroundColor Yellow
        Add-Content -Path ".env" -Value "`n# Elasticsearch Configuration`nELASTICREARCH_URL=http://localhost:9200"
        Write-Host "✓ ELASTICSEARCH_URL added to .env" -ForegroundColor Green
    }
} else {
    Write-Host "✗ .env file not found" -ForegroundColor Red
    Write-Host "  Creating .env with Elasticsearch configuration..." -ForegroundColor Yellow
    Set-Content -Path ".env" -Value "# Elasticsearch Configuration`nELASTICREARCH_URL=http://localhost:9200"
    Write-Host "✓ .env file created" -ForegroundColor Green
}

Write-Host ""

# Step 6: Prompt to restart server
Write-Host "Step 6: Next steps..." -ForegroundColor Yellow
Write-Host "→ Restart your server: npm start" -ForegroundColor Cyan
Write-Host "→ After server starts, run initial indexing:" -ForegroundColor Cyan
Write-Host "  node scripts/indexElasticsearch.js" -ForegroundColor Cyan

Write-Host ""
Write-Host "✓ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Yellow
Write-Host "  Check ES status:  curl http://localhost:9200" -ForegroundColor Gray
Write-Host "  View ES logs:     docker logs elasticsearch" -ForegroundColor Gray
Write-Host "  Stop ES:          docker stop elasticsearch" -ForegroundColor Gray
Write-Host "  Start ES:         docker start elasticsearch" -ForegroundColor Gray
Write-Host "  Remove ES:        docker rm -f elasticsearch" -ForegroundColor Gray
Write-Host ""
