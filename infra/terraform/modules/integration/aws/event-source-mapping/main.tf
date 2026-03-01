# -------------------------------------------------------
# SQS → Lambda Event Source Mappings
# -------------------------------------------------------
resource "aws_lambda_event_source_mapping" "sqs" {
  for_each = var.sqs_mappings

  event_source_arn = each.value.queue_arn
  function_name    = each.value.lambda_arn

  batch_size                         = each.value.batch_size
  maximum_batching_window_in_seconds = each.value.batching_window_seconds
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = each.value.maximum_concurrency
  }

  filter_criteria {
    dynamic "filter" {
      for_each = each.value.filters
      content {
        pattern = jsonencode(filter.value)
      }
    }
  }

  depends_on = [var.mapping_dependencies]
}

# -------------------------------------------------------
# EventBridge Pipe — DLQ → Lambda alerting (optional)
# Surfaces DLQ messages as structured alerts without
# needing a separate polling Lambda
# -------------------------------------------------------
resource "aws_pipes_pipe" "dlq_alert" {
  for_each = var.dlq_alert_mappings

  name     = each.value.name
  role_arn = each.value.role_arn

  source = each.value.dlq_arn
  target = each.value.lambda_arn

  source_parameters {
    sqs_queue_parameters {
      batch_size                         = 1
      maximum_batching_window_in_seconds = 0
    }
  }

  tags = merge(var.tags, {
    Name = each.key
  })
}
