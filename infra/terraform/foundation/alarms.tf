# -------------------------------------------------------
# CloudWatch Alarms
# -------------------------------------------------------

# H1/L1-2: Alert when any message lands in the agent-task DLQ.
# A message here means a task failed all 3 SQS retries (max_receive_count=3).
resource "aws_cloudwatch_metric_alarm" "agent_task_dlq" {
  alarm_name          = "${local.name_prefix}-agent-task-dlq"
  alarm_description   = "Messages in agent-task DLQ — task processing failed after all retries"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Sum"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = module.sqs.dlq_names["agent_task"]
  }

  alarm_actions = [module.sns_events.topic_arns["events"]]
  ok_actions    = [module.sns_events.topic_arns["events"]]
}
