#!/usr/bin/env bash

# --------------------------------------------------
# FitNEarn Windows Development Environment Setup
# Tested for: Git Bash on Windows 10/11
# --------------------------------------------------

# Exit on error, but handle errors gracefully
set -euo pipefail

log_info()  { echo "[INFO] $*"; }
log_ok()    { echo "[OK]   $*"; }
log_warn()  { echo "[WARN] $*"; }
log_error() { echo "[ERROR] $*" >&2; }

echo ""
echo "=============================================="
echo "  FitNEarn Dev Environment Setup (Windows)   "
echo "=============================================="
echo ""

# --------------------------------------------------
# 0. Check if running as Administrator
# --------------------------------------------------
log_info "Checking administrator privileges..."

if ! net session >/dev/null 2>&1; then
    log_error "This script must be run as Administrator!"
    echo ""
    echo "  How to fix:"
    echo "  1. Close this Git Bash window"
    echo "  2. Right-click 'Git Bash' in Start Menu"
    echo "  3. Select 'Run as administrator'"
    echo "  4. Navigate to your project: cd /c/path/to/fitnearn"
    echo "  5. Run: ./setup-dev-windows.sh"
    echo ""
    exit 1
fi

log_ok "Running as Administrator"

# --------------------------------------------------
# 1. Setup PATH helper function
# --------------------------------------------------
add_to_path() {
    local dir="$1"
    # Convert Windows path to Git Bash path if needed
    local bash_path
    bash_path=$(cygpath -u "$dir" 2>/dev/null || echo "$dir")
    
    if [ -d "$bash_path" ]; then
        case ":$PATH:" in
            *":$bash_path:"*) ;;  # Already in PATH
            *) export PATH="$PATH:$bash_path" ;;
        esac
    fi
}

# --------------------------------------------------
# 2. Install Chocolatey (if not present)
# --------------------------------------------------
install_chocolatey() {
    log_info "Checking Chocolatey..."

    # Check multiple possible locations
    local choco_paths=(
        "/c/ProgramData/chocolatey/bin"
        "/c/ProgramData/chocolatey/choco.exe"
    )

    for p in "${choco_paths[@]}"; do
        if [ -e "$p" ]; then
            add_to_path "/c/ProgramData/chocolatey/bin"
            break
        fi
    done

    if command -v choco >/dev/null 2>&1; then
        log_ok "Chocolatey already installed: $(choco --version)"
        return 0
    fi

    log_info "Installing Chocolatey..."
    
    # Use PowerShell to install - this is the official method
    powershell.exe -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command \
        "[System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"

    add_to_path "/c/ProgramData/chocolatey/bin"

    # Verify installation
    if ! command -v choco >/dev/null 2>&1; then
        log_error "Chocolatey installation failed"
        log_error "Please install manually: https://chocolatey.org/install"
        exit 1
    fi

    log_ok "Chocolatey installed successfully"
}

install_chocolatey

# --------------------------------------------------
# 3. Install required tools via Chocolatey
# --------------------------------------------------
install_tools() {
    echo ""
    log_info "Installing tools via Chocolatey..."

    # Install each tool separately for better error handling
    local tools=("make" "nodejs-lts" "docker-desktop" "awssamcli")

    for tool in "${tools[@]}"; do
        log_info "  Installing $tool..."
        if ! choco install "$tool" -y --no-progress --ignore-checksums 2>/dev/null; then
            log_warn "  $tool installation had issues (may already be installed)"
        fi
    done

    # Add common Windows tool paths to PATH (using Git Bash format)
    add_to_path "/c/Program Files/nodejs"
    add_to_path "/c/Program Files/Amazon/AWSSAMCLI/bin"
    add_to_path "/c/Program Files/Docker/Docker/resources/bin"
    add_to_path "/c/ProgramData/chocolatey/lib/make/tools/install/bin"

    log_ok "Tools installation complete"
}

install_tools

# --------------------------------------------------
# 4. Verify installations
# --------------------------------------------------
verify_tools() {
    echo ""
    log_info "Verifying installations..."

    local failed=0

    # Check each required tool
    if command -v make >/dev/null 2>&1; then
        log_ok "make installed"
    else
        log_warn "make not found - may need to restart terminal"
        ((failed++)) || true
    fi

    if command -v node >/dev/null 2>&1; then
        log_ok "node $(node -v)"
    else
        log_warn "node not found - may need to restart terminal"
        ((failed++)) || true
    fi

    if command -v npm >/dev/null 2>&1; then
        log_ok "npm $(npm -v)"
    else
        log_warn "npm not found"
        ((failed++)) || true
    fi

    if command -v sam >/dev/null 2>&1; then
        log_ok "sam $(sam --version 2>&1 | head -1)"
    else
        log_warn "sam not found - may need to restart terminal"
        ((failed++)) || true
    fi

    if command -v docker >/dev/null 2>&1; then
        log_ok "docker installed"
    else
        log_warn "docker not found - may need to restart terminal"
        ((failed++)) || true
    fi

    if [ $failed -gt 0 ]; then
        echo ""
        log_warn "$failed tool(s) not found in PATH"
        log_warn "If tools were just installed, close and reopen Git Bash as Administrator"
        echo ""
        read -p "Continue anyway? (y/N): " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

verify_tools

# --------------------------------------------------
# 5. Start Docker Desktop and wait for it
# --------------------------------------------------
start_docker() {
    echo ""
    log_info "Checking Docker..."

    # First check if docker command exists
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker CLI not found in PATH"
        log_error "Please restart Git Bash after Docker Desktop installation"
        exit 1
    fi

    # Check if Docker daemon is responding
    if docker info >/dev/null 2>&1; then
        log_ok "Docker is already running"
        return 0
    fi

    log_info "Starting Docker Desktop..."

    # Try to start Docker Desktop using PowerShell
    # Use Start-Process with the full path
    powershell.exe -Command "Start-Process -FilePath 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'" 2>/dev/null || \
    powershell.exe -Command "Start-Process 'Docker Desktop'" 2>/dev/null || {
        log_error "Could not start Docker Desktop automatically"
        echo ""
        echo "  Please start Docker Desktop manually:"
        echo "  1. Click Start Menu"
        echo "  2. Search for 'Docker Desktop'"
        echo "  3. Click to open it"
        echo "  4. Wait for it to fully start"
        echo "  5. Re-run this script"
        echo ""
        exit 1
    }

    # Wait for Docker with timeout and progress
    local timeout=180
    local elapsed=0
    local interval=5

    log_info "Waiting for Docker daemon (timeout: ${timeout}s)..."
    echo ""

    while true; do
        # Use timeout command to prevent hanging
        if timeout 5 docker info >/dev/null 2>&1; then
            echo ""
            log_ok "Docker is running"
            return 0
        fi

        sleep $interval
        elapsed=$((elapsed + interval))

        # Show progress on same line
        printf "\r  [%3ds / %3ds] Waiting for Docker daemon..." "$elapsed" "$timeout"

        if [ $elapsed -ge $timeout ]; then
            echo ""
            log_error "Docker failed to start within ${timeout} seconds"
            echo ""
            echo "  Troubleshooting:"
            echo "  1. Open Docker Desktop manually"
            echo "  2. Wait for the whale icon in system tray to stop animating"
            echo "  3. If Docker shows errors, try restarting your computer"
            echo "  4. Re-run this script"
            echo ""
            exit 1
        fi
    done
}

start_docker

# --------------------------------------------------
# 6. Cleanup previous builds
# --------------------------------------------------
cleanup() {
    echo ""
    log_info "Cleaning up previous builds..."
    
    rm -rf .aws-sam 2>/dev/null || true
    rm -rf dist 2>/dev/null || true
    rm -rf node_modules/.cache 2>/dev/null || true
    
    log_ok "Cleanup complete"
}

cleanup

# --------------------------------------------------
# 7. Install dependencies
# --------------------------------------------------
install_dependencies() {
    echo ""
    log_info "Installing dependencies..."

    # Install layer dependencies
    if [ -d "layers/common" ]; then
        log_info "  Installing layers/common..."
        pushd layers/common >/dev/null
        npm install --legacy-peer-deps
        popd >/dev/null
        log_ok "Layer dependencies installed"
    else
        log_warn "layers/common directory not found - skipping"
    fi

    # Install root dependencies if package.json exists
    if [ -f "package.json" ]; then
        log_info "  Installing root dependencies..."
        npm install --legacy-peer-deps
        log_ok "Root dependencies installed"
    fi
}

install_dependencies

# --------------------------------------------------
# 8. Build shared layer (if script exists)
# --------------------------------------------------
build_shared() {
    if [ -f "build-shared.sh" ]; then
        echo ""
        log_info "Building shared layer..."
        chmod +x build-shared.sh
        bash ./build-shared.sh
        log_ok "Shared layer built"
    fi
}

build_shared

# --------------------------------------------------
# 9. SAM build
# --------------------------------------------------
sam_build() {
    echo ""
    log_info "Running SAM build..."

    # Use --use-container for consistent builds across platforms
    if ! sam build --use-container; then
        log_warn "Container build failed, trying native build..."
        if ! sam build; then
            log_error "SAM build failed"
            exit 1
        fi
    fi

    log_ok "SAM build complete"
}

sam_build

# --------------------------------------------------
# 10. Start local API
# --------------------------------------------------
start_api() {
    echo ""
    echo "=============================================="
    echo "        STARTING LOCAL API SERVER            "
    echo "=============================================="
    echo ""
    echo "  URL:  http://localhost:3000"
    echo "  Stop: Press Ctrl+C"
    echo ""
    echo "=============================================="
    echo ""

    # Start without --skip-pull-image to ensure images exist
    # Use --warm-containers for faster subsequent invocations
    sam local start-api \
        --port 3000 \
        --warm-containers EAGER \
        --docker-network host 2>/dev/null || \
    sam local start-api \
        --port 3000 \
        --warm-containers EAGER
}

start_api