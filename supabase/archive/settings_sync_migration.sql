-- ============================================
-- Intrack — Cross-Device Settings Sync Migration
-- Run this in Supabase SQL Editor to add settings columns
-- ============================================

-- 1. Alter public.profiles to add settings columns
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR' CHECK (currency IN ('INR', 'USD')),
ADD COLUMN IF NOT EXISTS active_financial_year INTEGER DEFAULT 2026,
ADD COLUMN IF NOT EXISTS promo_code TEXT DEFAULT NULL;
