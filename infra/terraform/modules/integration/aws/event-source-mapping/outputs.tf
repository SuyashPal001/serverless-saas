output "sqs_mapping_ids" {
  description = "Map of logical name → SQS event source mapping UUID."
  value       = { for k, v in aws_lambda_event_source_mapping.sqs : k => v.uuid }
}

output "sqs_mapping_arns" {
  description = "Map of logical name → SQS event source mapping ARN."
  value       = { for k, v in aws_lambda_event_source_mapping.sqs : k => v.function_arn }
}

output "dlq_pipe_arns" {
  description = "Map of logical name → EventBridge Pipe ARN for DLQ alerting."
  value       = { for k, v in aws_pipes_pipe.dlq_alert : k => v.arn }
}
