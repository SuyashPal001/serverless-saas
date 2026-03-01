resource "aws_cloudwatch_log_group" "this" {
  for_each = var.log_groups

  name              = each.value.name
  retention_in_days = each.value.retention_in_days
  kms_key_id        = each.value.kms_key_id

  tags = merge(var.tags, {
    Name = each.key
  })
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each = var.metric_alarms

  alarm_name          = each.value.alarm_name
  alarm_description   = each.value.alarm_description
  comparison_operator = each.value.comparison_operator
  evaluation_periods  = each.value.evaluation_periods
  metric_name         = each.value.metric_name
  namespace           = each.value.namespace
  period              = each.value.period
  statistic           = each.value.statistic
  threshold           = each.value.threshold
  treat_missing_data  = lookup(each.value, "treat_missing_data", "notBreaching")

  dimensions = each.value.dimensions

  alarm_actions = each.value.alarm_actions
  ok_actions    = lookup(each.value, "ok_actions", [])

  tags = merge(var.tags, {
    Name = each.key
  })
}
