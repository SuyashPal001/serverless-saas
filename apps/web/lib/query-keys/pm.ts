export const pmKeys = {
    plans:          (tenantId: string)     => ['plans', tenantId] as const,
    plan:           (planId: string)       => ['plan', planId] as const,
    planSummary:    (planId: string)       => ['planSummary', planId] as const,
    milestones:     (planId: string)       => ['milestones', planId] as const,
    milestone:      (milestoneId: string)  => ['milestone', milestoneId] as const,
    milestoneTasks: (milestoneId: string)  => ['milestoneTasks', milestoneId] as const,
    planTasks:      (planId: string)       => ['planTasks', planId] as const,
    subtasks:       (taskId: string)       => ['subtasks', taskId] as const,
}
