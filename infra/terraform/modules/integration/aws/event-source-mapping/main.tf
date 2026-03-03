# -------------------------------------------------------
# SQS → Lambda Event Source Mappings
# Only created when lambda_arn is non-empty
# Pass 1: empty ARNs → skipped
# Pass 2: real ARNs → wired
# -------------------------------------------------------
locals {
  active_sqs_mappings = {
    for k, v in var.sqs_mappings : k => v
    if v.lambda_arn != ""
  }
}

resource "aws_lambda_event_source_mapping" "sqs" {
  for_each = local.active_sqs_mappings

  event_source_arn = each.value.queue_arn
  function_name    = each.value.lambda_arn

  batch_size                         = each.value.batch_size
  maximum_batching_window_in_seconds = each.value.batching_window_seconds
  function_response_types            = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = each.value.maximum_concurrency
  }

  dynamic "filter_criteria" {
    for_each = length(each.value.filters) > 0 ? [1] : []
    content {
      dynamic "filter" {
        for_each = each.value.filters
        content {
          pattern = jsonencode(filter.value)
        }
      }
    }
  }

  depends_on = [var.mapping_dependencies]
}

# -------------------------------------------------------
# EventBridge Pipe — DLQ → Lambda alerting (optional)
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
