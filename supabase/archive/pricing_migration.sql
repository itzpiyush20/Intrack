-- ============================================
-- Intrack — Pricing & Trial Migration
-- Run this in Supabase SQL Editor to add trial gating
-- ============================================

-- 1. Alter public.profiles to add trial/subscription columns
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'canceled', 'past_due')),
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ DEFAULT (now() + interval '14 days'),
ADD COLUMN IF NOT EXISTS subscription_plan_type TEXT DEFAULT 'trial' CHECK (subscription_plan_type IN ('trial', 'monthly', 'annual', 'lifetime'));

-- 2. Update existing accounts to have a valid subscription_expires_at relative to their creation
UPDATE public.profiles
SET subscription_expires_at = created_at + interval '14 days'
WHERE subscription_expires_at IS NULL;

