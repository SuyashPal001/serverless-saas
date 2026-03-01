# -------------------------------------------------------
# Core
# -------------------------------------------------------
project     = "serverless-saas"
environment = "dev"
region      = "ap-south-1"

# -------------------------------------------------------
# Cognito
# -------------------------------------------------------
cognito_domain_prefix = "serverless-saas-dev"

# Populated after first SAM deploy
pre_token_generation_lambda_arn = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-pretoken-dev"

# -------------------------------------------------------
# API Gateway
# -------------------------------------------------------
api_name           = "serverless-saas-api-dev"
api_stage_name     = "$default"
cors_allow_origins = ["http://localhost:3000"]

# -------------------------------------------------------
# SQS
# -------------------------------------------------------
processing_queue_name      = "serverless-saas-processing-dev"
workflow_queue_name        = "serverless-saas-workflow-dev"
message_retention_seconds  = 86400
visibility_timeout_seconds = 30

# -------------------------------------------------------
# SNS
# -------------------------------------------------------
events_topic_name = "serverless-saas-events-dev"

# -------------------------------------------------------
# EventBridge
# -------------------------------------------------------
event_bus_name = "serverless-saas-events-dev"

# -------------------------------------------------------
# CloudWatch
# -------------------------------------------------------
log_retention_days = 30

# -------------------------------------------------------
# Lambda ARNs (populate after first SAM deploy)
# -------------------------------------------------------
foundation_api_lambda_arn    = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-api-dev"
foundation_worker_lambda_arn = "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:serverless-saas-foundation-worker-dev"
