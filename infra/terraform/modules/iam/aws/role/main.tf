resource "aws_iam_role" "this" {
  for_each = var.roles

  name               = each.value.name
  description        = each.value.description
  assume_role_policy = each.value.assume_role_policy

  tags = merge(var.tags, {
    Name = each.key
  })
}

resource "aws_iam_role_policy_attachment" "this" {
  for_each = {
    for item in flatten([
      for role_key, role in var.roles : [
        for arn in role.policy_arns : {
          key  = "${role_key}:${arn}"
          role = role_key
          arn  = arn
        }
      ]
    ]) : item.key => item
  }

  role       = aws_iam_role.this[each.value.role].name
  policy_arn = each.value.arn
}

resource "aws_iam_role_policy" "this" {
  for_each = {
    for item in flatten([
      for role_key, role in var.roles : [
        for policy_name, policy_json in role.inline_policies : {
          key         = "${role_key}:${policy_name}"
          role        = role_key
          policy_name = policy_name
          policy_json = policy_json
        }
      ]
    ]) : item.key => item
  }

  name   = each.value.policy_name
  role   = aws_iam_role.this[each.value.role].name
  policy = each.value.policy_json
}
