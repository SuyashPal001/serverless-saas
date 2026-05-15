# 🚀 AWS SAM TypeScript Baseline

A production-ready AWS Serverless Application Model (SAM) baseline project using TypeScript, designed for scalable Lambda functions with shared utilities, modular architecture, and multi-environment deployment.

---

## ✨ Features

- ✅ **TypeScript** - Full TypeScript support with strict type checking
- ✅ **Modular Architecture** - Clean separation of functions and shared utilities
- ✅ **Lambda Layers** - Shared code compiled into reusable layers
- ✅ **Multi-Environment** - Separate configs for dev, staging, and production
- ✅ **Local Development** - Test functions locally with SAM CLI
- ✅ **AWS Services Integration** - Cognito, SES, MongoDB, SSM, Secrets Manager
- ✅ **Automated Scripts** - Build, deploy, and testing workflows
- ✅ **Best Practices** - Following AWS and TypeScript best practices

---

## 🏗️ Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway (REST)                      │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │ PingFunction │ │ AuthFunction │ │EmailFunction │
      │   (Health)   │ │  (Register)  │ │  (Welcome)   │
      └──────────────┘ └──────────────┘ └──────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │   Shared Layer      │
                   │  (TypeScript Utils) │
                   └─────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
    ┌─────────┐         ┌─────────┐        ┌──────────┐
    │ Cognito │         │   SES   │        │ MongoDB  │
    └─────────┘         └─────────┘        └──────────┘
```

---

## 📋 Prerequisites

- **Node.js**: >= 20.0.0
- **npm**: >= 9.0.0
- **AWS CLI**: Configured with credentials
- **AWS SAM CLI**: Latest version
- **Docker**: For local Lambda execution

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Project
```bash
npm run build
```

### 3. Start Local Development
```bash
npm start
```

Your API will be available at `http://127.0.0.1:3000`

### 4. Test Endpoints
```bash
# Health check
curl http://127.0.0.1:3000/ping

# Register user
curl -X POST http://127.0.0.1:3000/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234!"}'
```

---

## 📦 Project Structure
```
aws-sam-baseline/
├── src/
│   ├── functions/              # Lambda function handlers
│   │   ├── ping/               # Health check endpoint
│   │   ├── auth/               # User authentication
│   │   └── email/              # Email notifications
│   └── shared/                 # Shared utilities (Lambda Layer)
│       ├── config/             # Configuration management
│       ├── services/           # AWS service wrappers
│       │   ├── cognitoService.ts
│       │   ├── sesService.ts
│       │   └── mongoService.ts
│       └── utils/              # Common utilities
├── events/                     # Test event payloads
├── build-shared.sh             # Build script for shared layer
├── start-local.sh              # Local API startup script
├── template.yaml               # SAM infrastructure template
├── env.json                    # Local environment variables
├── samconfig.dev.toml          # Dev deployment config
├── samconfig.staging.toml      # Staging deployment config
├── samconfig.prod.toml         # Production deployment config
└── package.json                # Dependencies and scripts
```

---

## 🛠️ Available Scripts

### Development
```bash
npm start              # Start local API server (port 3000)
npm run build          # Build shared layer + functions
npm run clean          # Remove build artifacts
npm run type-check     # TypeScript type checking
npm run lint           # Check code style
npm run lint:fix       # Auto-fix linting issues
```

### Testing
```bash
npm run invoke:ping    # Test ping function locally
npm run invoke:auth    # Test auth function locally
npm run invoke:email   # Test email function locally
npm run validate       # Validate SAM template
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
npm run logs              # Tail dev environment logs
```

---

## 🌍 Multi-Environment Setup

This project supports three environments:

| Environment | Stack Name      | Config File              | Purpose                    |
|-------------|-----------------|--------------------------|----------------------------|
| Development | `myapp-dev`     | `samconfig.dev.toml`     | Active development/testing |
| Staging     | `myapp-staging` | `samconfig.staging.toml` | Pre-production validation  |
| Production  | `myapp-prod`    | `samconfig.prod.toml`    | Live production workloads  |

### Environment-Specific Configuration

Each environment uses:
- **Separate CloudFormation stacks**
- **Separate S3 buckets** for deployment artifacts
- **Separate AWS resources** (Cognito pools, databases, etc.)
- **Environment-specific secrets** (AWS SSM/Secrets Manager)

---

## 🔐 Security & Secrets Management

### Local Development
- **File**: `env.json` (committed to git)
- Contains: Resource IDs and SSM paths **only**
- **Never** contains actual secrets

### Cloud Environments
Secrets are managed via:
- **AWS SSM Parameter Store** - Configuration values (Client IDs)
- **AWS Secrets Manager** - Sensitive data (DB credentials, secrets)

**Required Secrets:**
```bash
# Cognito Client ID (SSM)
/myapp/{env}/auth/clientId

# Cognito Client Secret (SSM)
/myapp/{env}/auth/clientSecret

# MongoDB Connection (Secrets Manager)
myapp/{env}/mongodb
```

---

## 📚 API Endpoints

### Health Check
```
GET /ping
Response: { "message": "pong", "timestamp": "..." }
```

### User Registration
```
POST /register
Body: {
  "email": "user@example.com",
  "password": "SecurePass123!",
  "givenName": "John",
  "familyName": "Doe"
}
```

### Send Welcome Email
```
POST /welcome-email
Body: {
  "email": "user@example.com",
  "name": "John Doe"
}
```

---

## 🧪 Testing

### Local Testing
```bash
# Start local API
npm start

# In another terminal, test endpoints
curl http://127.0.0.1:3000/ping

# Or use test events
npm run invoke:ping
```

### Integration Testing
```bash
# Deploy to dev environment
npm run deploy:dev

# Test against deployed stack
curl https://your-api-id.execute-api.ap-south-1.amazonaws.com/Prod/ping
```

---

## 🚢 Deployment Guide

### First-Time Deployment

1. **Configure AWS credentials**
```bash
   aws configure --profile myapp-dev
```

2. **Create required secrets** in AWS SSM/Secrets Manager
```bash
   # See DEVELOPMENT.md for detailed instructions
```

3. **Deploy to dev**
```bash
   npm run deploy:dev
```

### Updating Existing Stack
```bash
# Build changes
npm run build

# Deploy
npm run deploy:dev
```

### Production Deployment
```bash
# Always use guided mode for production
npm run deploy:prod

# Review changes carefully before confirming!
```

---

## 🐛 Troubleshooting

### Port 3000 Already in Use
```bash
# Script automatically handles this, but if needed:
pkill -f "sam local"
npm start
```

### Build Errors
```bash
npm run clean
npm run build
```

### AWS Credentials Issues
```bash
aws sts get-caller-identity
export AWS_PROFILE=myapp-dev
```

### MongoDB Connection Fails
- Verify secret exists in AWS Secrets Manager
- Check security groups allow your IP
- Ensure IAM role has `secretsmanager:GetSecretValue` permission

**For detailed troubleshooting, see [DEVELOPMENT.md](./DEVELOPMENT.md)**

---

## 📖 Documentation

- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Comprehensive development guide
- **[AWS SAM Documentation](https://docs.aws.amazon.com/serverless-application-model/)** - Official SAM docs
- **[TypeScript Handbook](https://www.typescriptlang.org/docs/)** - TypeScript reference

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test locally: `npm run build && npm start`
5. Run linting: `npm run lint:fix`
6. Commit: `git commit -am 'Add feature'`
7. Push: `git push origin feature/my-feature`
8. Open a Pull Request

---

## 📄 License

MIT License - See LICENSE file for details

---

## 👥 Support

For questions or issues:
- Open an issue on GitHub
- Check [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed guides
- Review AWS SAM documentation

---

**Built with ❤️ using AWS SAM + TypeScript**
