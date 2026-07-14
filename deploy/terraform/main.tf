terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "me-south-1" # Bahrain — closest AWS region to Egypt/UAE/KSA, per System Architecture Section 9
}

variable "environment" {
  default = "production"
}

# --- Networking ---
resource "aws_vpc" "nafaqa" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "nafaqa-${var.environment}-vpc" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.nafaqa.id
  cidr_block        = cidrsubnet(aws_vpc.nafaqa.cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "nafaqa-private-${count.index}" }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# --- ECS Cluster ---
resource "aws_ecs_cluster" "nafaqa" {
  name = "nafaqa-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_service" "backend" {
  name            = "nafaqa-backend-service"
  cluster         = aws_ecs_cluster.nafaqa.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 2 # baseline redundancy; scale via aws_appautoscaling_target below
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.backend.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name   = "nafaqa-backend"
    container_port   = 3000
  }
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "nafaqa-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn
  container_definitions    = file("${path.module}/../deploy/ecs-task-definition.json")
}

# --- Autoscaling: scale on CPU utilization, per System Architecture Section 9 ---
resource "aws_appautoscaling_target" "backend" {
  max_capacity       = 10
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.nafaqa.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "nafaqa-backend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 65
  }
}

# --- Security group: only the load balancer can reach the backend ---
resource "aws_security_group" "backend" {
  name   = "nafaqa-backend-sg"
  vpc_id = aws_vpc.nafaqa.id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "alb" {
  name   = "nafaqa-alb-sg"
  vpc_id = aws_vpc.nafaqa.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "backend" {
  name               = "nafaqa-backend-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.private[*].id
}

resource "aws_lb_target_group" "backend" {
  name        = "nafaqa-backend-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.nafaqa.id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }
}

# --- IAM: least-privilege roles per Security Review Section 7 ---
resource "aws_iam_role" "ecs_execution" {
  name = "nafaqa-ecs-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_policy" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "nafaqa-backend-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# KMS decrypt permission scoped ONLY to the backend task role, per the
# Security Review's key management design (Section 4/7) — no other role in
# the account can invoke Decrypt/GenerateDataKey on this key.
resource "aws_iam_role_policy" "ecs_task_kms" {
  name = "nafaqa-backend-kms-access"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
      Resource = aws_kms_key.nafaqa.arn
    }]
  })
}

resource "aws_kms_key" "nafaqa" {
  description             = "Nafaqa CMK — wraps per-user DEKs for message_imports encryption (Security Review Section 4)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

output "load_balancer_dns" {
  value = aws_lb.backend.dns_name
}
