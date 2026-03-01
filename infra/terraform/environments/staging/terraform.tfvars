# -------------------------------------------------------
# Core
# -------------------------------------------------------
project     = "serverless-saas"
environment = "staging"
region      = "ap-south-1"

# -------------------------------------------------------
# Cognito
# -------------------------------------------------------
cognito_domain_prefix = "serverless-saas-staging"

# Populated after first SAM deploy
pre_token_generation_lambda_arn = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-pretoken-staging"

# -------------------------------------------------------
# API Gateway
# -------------------------------------------------------
api_name           = "serverless-saas-api-staging"
api_stage_name     = "$default"
cors_allow_origins = ["https://staging.yourapp.com"]

# -------------------------------------------------------
# SQS
# -------------------------------------------------------
processing_queue_name      = "serverless-saas-processing-staging"
workflow_queue_name        = "serverless-saas-workflow-staging"
message_retention_seconds  = 86400
visibility_timeout_seconds = 30

# -------------------------------------------------------
# SNS
# -------------------------------------------------------
events_topic_name = "serverless-saas-events-staging"

# -------------------------------------------------------
# EventBridge
# -------------------------------------------------------
event_bus_name = "serverless-saas-events-staging"

# -------------------------------------------------------
# CloudWatch
# -------------------------------------------------------
log_retention_days = 30

# -------------------------------------------------------
# Lambda ARNs (populate after first SAM deploy)
# -------------------------------------------------------
foundation_api_lambda_arn    = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-api-staging"
foundation_worker_lambda_arn = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-worker-staging"
