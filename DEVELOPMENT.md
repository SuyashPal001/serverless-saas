# 🚀 Development Guide

**AWS SAM TypeScript Baseline** - Local development and deployment guide.

---

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Local Development](#local-development)
- [Testing Functions](#testing-functions)
- [Deployment](#deployment)
- [Environment Configuration](#environment-configuration)
- [Troubleshooting](#troubleshooting)

---

## ✅ Prerequisites

Before you begin, ensure you have:

- **Node.js**: >= 20.0.0
- **npm**: >= 9.0.0
- **AWS CLI**: Configured with appropriate credentials
- **AWS SAM CLI**: Latest version
- **Docker**: For running functions locally

### Install AWS SAM CLI
```bash
# macOS
brew install aws-sam-cli

# Linux
pip install aws-sam-cli

# Verify installation
sam --version
```

### Configure AWS Credentials
```bash
# Configure AWS CLI with your credentials
aws configure --profile myapp-dev

# Set default region
export AWS_REGION=ap-south-1
```

---

## 📁 Project Structure
```
aws-sam-baseline/
├── src/
│   ├── functions/          # Lambda function handlers
│   │   ├── ping/           # Health check function
│   │   ├── auth/           # User authentication
│   │   └── email/          # Email sending
│   └── shared/             # Shared utilities (compiled to Lambda Layer)
│       ├── config/         # Configuration
│       ├── services/       # AWS service helpers (Cognito, SES, MongoDB)
│       └── utils/          # Common utilities
├── events/                 # Test event payloads
│   ├── ping-event.json
│   ├── register.json
│   └── welcome-email.json
├── dist/                   # Compiled TypeScript output
├── .aws-sam/              # SAM build artifacts (generated)
├── template.yaml          # SAM infrastructure template
├── env.json               # Local environment variables
├── samconfig.dev.toml     # Dev deployment config
├── samconfig.staging.toml # Staging deployment config
├── samconfig.prod.toml    # Production deployment config
├── build-shared.sh        # Build script for shared layer
├── start-local.sh         # Start local API server
├── package.json           # Node.js dependencies and scripts
└── tsconfig.json          # TypeScript configuration
```

---

## 🚀 Getting Started

### 1. Clone and Install
```bash
# Clone the repository
git clone <your-repo-url>
cd fitnearn-backend

# Install dependencies
cd layers/common && npm install && cd ../..
npm install
```

### 2. Build the Project
```bash

Build shared layers
./build-shared.sh
```

### 3. Build SAM:

sam build
or sudo sam build ( if permission error )


## 🛠️ Local Development

### Running the Local API
```bash
# Start local API (port 3000)
npm start

# Or use an alternative port
bash start-local.sh 3001
```

Your API endpoints will be available at:
- `GET  http://127.0.0.1:3000/ping` - Health check
- `POST http://127.0.0.1:3000/register` - User registration
- `POST http://127.0.0.1:3000/welcome-email` - Send welcome email

### Hot Reload

SAM CLI supports hot reload for code changes:
1. Make changes to your TypeScript files in `src/`
2. Run `npm run build` to recompile
3. Test changes immediately (no need to restart SAM)

### Environment Variables

Local environment variables are configured in `env.json`:
```json
{
  "PingFunction": {
    "COGNITO_USER_POOL_ID": "ap-south-1_xxxxx",
    "MONGODB_SECRET_ID": "myapp/dev/mongodb"
  }
}
```

**Important:** `env.json` contains only resource identifiers and SSM/Secrets Manager paths - **never actual secrets**.

---

## 🧪 Testing Functions

### Test Individual Functions
```bash
# Test ping function
npm run invoke:ping

# Test authentication function
npm run invoke:auth

# Test email function
npm run invoke:email
```

### Test with Custom Events
```bash
# Invoke with custom event file
sam local invoke PingFunction --env-vars env.json -e events/custom-event.json
```

### Test via HTTP Requests

With the local API running (`npm start`), test with curl:
```bash
# Health check
curl http://127.0.0.1:3000/ping

# Register user
curl -X POST http://127.0.0.1:3000/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234!",
    "givenName": "Test",
    "familyName": "User"
  }'

# Send welcome email
curl -X POST http://127.0.0.1:3000/welcome-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User"
  }'
```

---

## 🚢 Deployment

### Deploy to Development
```bash
# Deploy to dev environment
npm run deploy:dev

# Or manually
sam deploy --config-file samconfig.dev.toml
```

### Deploy to Staging
```bash
# Deploy to staging (with confirmation prompt)
npm run deploy:staging

# Follow the guided prompts
```

### Deploy to Production
```bash
# Deploy to production (requires confirmation)
npm run deploy:prod

# IMPORTANT: Review all changes carefully!
```

### Deployment Configuration

Each environment has its own configuration file:

- `samconfig.dev.toml` - Development environment
- `samconfig.staging.toml` - Staging environment
- `samconfig.prod.toml` - Production environment

These files specify:
- Stack name
- S3 bucket for artifacts
- AWS region
- Parameter overrides (environment-specific settings)

---

## 🔧 Environment Configuration

### Local Development

**File:** `env.json` (committed to git)

Contains:
- ✅ Public resource identifiers (Cognito Pool ID, S3 bucket names)
- ✅ SSM/Secrets Manager paths
- ❌ NO actual secrets or credentials

### Cloud Environments (Dev/Staging/Prod)

**Secrets are managed via:**
- **AWS SSM Parameter Store** - For configuration values (Cognito Client ID)
- **AWS Secrets Manager** - For sensitive data (MongoDB URI, Client Secret)

### Required AWS Secrets

Before deploying, ensure these secrets exist in AWS:
```bash
# Cognito Client ID (SSM Parameter Store)
aws ssm put-parameter \
  --name "/myapp/dev/auth/clientId" \
  --value "your-client-id" \
  --type "String"

# Cognito Client Secret (SSM Parameter Store)
aws ssm put-parameter \
  --name "/myapp/dev/auth/clientSecret" \
  --value "your-client-secret" \
  --type "SecureString"

# MongoDB Connection String (Secrets Manager)
aws secretsmanager create-secret \
  --name "myapp/dev/mongodb" \
  --secret-string '{"uri":"mongodb+srv://..."}'
```

---

## 🐛 Troubleshooting

### Port 3000 Already in Use

**Problem:** `Address already in use` error when starting local API.

**Solution:**
```bash
# The start-local.sh script automatically handles this
# But if needed, manually kill the process:
pkill -f "sam local"

# Or kill specific port
lsof -ti:3000 | xargs kill -9
```

### Build Errors

**Problem:** TypeScript compilation fails.

**Solution:**
```bash
# Clean build artifacts
npm run clean

# Rebuild everything
npm run build

# Check for TypeScript errors
npm run type-check
```

### Lambda Function Timeout

**Problem:** Function times out during local testing.

**Solution:**
```bash
# Increase timeout in template.yaml
Timeout: 30  # seconds

# Rebuild
sam build
```

### AWS Credentials Issues

**Problem:** `Unable to locate credentials` error.

**Solution:**
```bash
# Verify AWS CLI is configured
aws sts get-caller-identity

# Set AWS profile
export AWS_PROFILE=myapp-dev

# Or configure credentials
aws configure
```

### MongoDB Connection Fails Locally

**Problem:** Can't connect to MongoDB from local Lambda.

**Expected:** This is normal! Local Lambda functions connect to real AWS resources (dev environment).

**Solution:**
- Ensure AWS credentials are configured
- Verify MongoDB secret exists in Secrets Manager
- Check security groups allow your IP

### Cognito Errors

**Problem:** `User pool client does not exist` error.

**Solution:**
```bash
# Verify Cognito resources exist
aws cognito-idp describe-user-pool --user-pool-id ap-south-1_xxxxx

# Check SSM parameters
aws ssm get-parameter --name "/myapp/dev/auth/clientId"
```

---

## 📚 Useful Commands

### Development
```bash
npm start                  # Start local API server
npm run build             # Build everything
npm run clean             # Remove build artifacts
npm run type-check        # TypeScript type checking
npm run lint              # Lint code
npm run lint:fix          # Auto-fix linting issues
```

### Testing
```bash
npm run invoke:ping       # Test ping function
npm run invoke:auth       # Test auth function
npm run invoke:email      # Test email function
npm run validate          # Validate SAM template
```

### Deployment
```bash
npm run deploy            # Deploy to dev (default)
npm run deploy:dev        # Deploy to development
npm run deploy:staging    # Deploy to staging
npm run deploy:prod       # Deploy to production
```

### Monitoring
```bash
npm run logs              # Tail dev logs
sam logs --stack-name myapp-dev --tail
sam logs -n PingFunction --stack-name myapp-dev --tail
```

---

## 🔐 Security Best Practices

1. **Never commit secrets** to git
   - Use `.gitignore` for `.env.local` files
   - Store secrets in AWS SSM/Secrets Manager

2. **Use IAM roles** for Lambda functions
   - Don't use IAM user credentials in Lambda
   - Assign minimal required permissions

3. **Rotate secrets regularly**
   - Update MongoDB passwords
   - Rotate Cognito client secrets

4. **Review deployment changes**
   - Always use `--guided` for staging/prod
   - Review CloudFormation change sets

5. **Use separate AWS accounts** for environments
   - Dev: Testing and development
   - Staging: Pre-production testing
   - Prod: Production workloads

---

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Test locally: `npm run build && npm start`
4. Run linting: `npm run lint:fix`
5. Commit changes: `git commit -am 'Add feature'`
6. Push branch: `git push origin feature/my-feature`
7. Open a Pull Request

---

## 📞 Support

- **Documentation:** See [README.md](./README.md)
- **AWS SAM Docs:** https://docs.aws.amazon.com/serverless-application-model/

---

**Happy Coding! 🚀**
