# -------------------------------------------------------
# Core
# -------------------------------------------------------
project     = "serverless-saas"
environment = "prod"
region      = "ap-south-1"

# -------------------------------------------------------
# Cognito
# -------------------------------------------------------
cognito_domain_prefix = "serverless-saas-prod"

# Populated after first SAM deploy
pre_token_generation_lambda_arn = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-pretoken-prod"

# -------------------------------------------------------
# API Gateway
# -------------------------------------------------------
api_name           = "serverless-saas-api-prod"
api_stage_name     = "$default"
cors_allow_origins = ["https://yourapp.com"]

# -------------------------------------------------------
# SQS
# -------------------------------------------------------
processing_queue_name      = "serverless-saas-processing-prod"
workflow_queue_name        = "serverless-saas-workflow-prod"
message_retention_seconds  = 345600
visibility_timeout_seconds = 30

# -------------------------------------------------------
# SNS
# -------------------------------------------------------
events_topic_name = "serverless-saas-events-prod"

# -------------------------------------------------------
# EventBridge
# -------------------------------------------------------
event_bus_name = "serverless-saas-events-prod"

# -------------------------------------------------------
# CloudWatch
# -------------------------------------------------------
log_retention_days = 90

# -------------------------------------------------------
# Lambda ARNs (populate after first SAM deploy)
# -------------------------------------------------------
foundation_api_lambda_arn    = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-api-prod"
foundation_worker_lambda_arn = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-worker-prod"

# -------------------------------------------------------
# OAuth redirect URIs
# -------------------------------------------------------
jira_redirect_uri   = "https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com/api/v1/integrations/jira/callback"
google_redirect_uri = "https://qh9a33hgbd.execute-api.ap-south-1.amazonaws.com/api/v1/integrations/google/callback"

# -------------------------------------------------------
# Frontend
# -------------------------------------------------------
frontend_url = "https://yourapp.com"
