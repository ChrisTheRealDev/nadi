import type { TrackingGoal } from './client'
export type ReviewStatus = 'awaiting-review' | 'changes-requested' | 'reviewed'
export interface PlannerStep { id: string; label: string; done: boolean; position: number; version: number }
export interface PlannerReview { id: string; status: ReviewStatus; snapshot_id: string; revision: number; reflection: string; version: number; created_at: string; updated_at: string }
export interface PlannerGoal extends TrackingGoal { learner_id: string; mentor_id: string; steps: PlannerStep[]; project_id: string | null; review: PlannerReview | null; reviews: PlannerReview[] }
export interface PlannerProject { projectId: string; name: string; revision: number; updatedAt: string; snapshotId: string | null }
export interface PlannerData { goals: PlannerGoal[]; projects: PlannerProject[] }
export type PlannerKind = 'goal-edit' | 'step-add' | 'step-edit' | 'step-toggle' | 'step-reorder' | 'project-link' | 'review-submit' | 'review-status'
export interface ConnectionMutationResult { id?: string; version?: number; saved?: boolean; read?: number; snapshotId?: string; revision?: number }
