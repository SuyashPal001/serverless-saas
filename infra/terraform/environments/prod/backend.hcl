bucket         = "fitnearn-terraform-state-platform"
region         = "ap-south-1"
dynamodb_table = "terraform-platform-locks"
encrypt        = true
key            = "prod/aws/ap-south-1/foundation/terraform.tfstate"
