locals {
  queues_with_dlq = {
    for k, v in var.queues : k => v if v.create_dlq
  }
}

# -------------------------------------------------------
# Dead Letter Queues
# Created first — main queues reference their ARNs
# -------------------------------------------------------
resource "aws_sqs_queue" "dlq" {
  for_each = local.queues_with_dlq

  name                      = "${each.value.name}-dlq${each.value.fifo ? ".fifo" : ""}"
  fifo_queue                = each.value.fifo
  message_retention_seconds = 1209600
  kms_master_key_id         = each.value.kms_key_id

  tags = merge(var.tags, {
    Name = "${each.key}-dlq"
    Type = "dlq"
  })
}

# -------------------------------------------------------
# Main Queues
# -------------------------------------------------------
resource "aws_sqs_queue" "this" {
  for_each = var.queues

  name                       = "${each.value.name}${each.value.fifo ? ".fifo" : ""}"
  fifo_queue                 = each.value.fifo
  visibility_timeout_seconds = each.value.visibility_timeout_seconds
  message_retention_seconds  = each.value.message_retention_seconds
  delay_seconds              = each.value.delay_seconds
  max_message_size           = each.value.max_message_size
  receive_wait_time_seconds  = each.value.receive_wait_time_seconds
  kms_master_key_id          = each.value.kms_key_id

  redrive_policy = each.value.create_dlq ? jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = each.value.max_receive_count
  }) : null

  tags = merge(var.tags, {
    Name = each.key
    Type = "queue"
  })
}

# -------------------------------------------------------
# Queue Policy
# Allows SNS topics to send to this queue (if provided)
# -------------------------------------------------------
resource "aws_sqs_queue_policy" "this" {
  for_each = {
    for k, v in var.queues : k => v if length(v.allowed_sns_topic_arns) > 0
  }

  queue_url = aws_sqs_queue.this[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowSNSPublish"
        Effect    = "Allow"
        Principal = { Service = "sns.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.this[each.key].arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = each.value.allowed_sns_topic_arns
          }
        }
      }
    ]
  })
}
