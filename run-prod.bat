@echo off
:: Production Run Script for Manifest Generator
:: This script handles Prisma synchronization, building, and starting the app.

echo [1/4] Generating Prisma Client...
call npx prisma generate

echo [2/4] Pushing Schema Changes to Database...
call npx prisma db push

echo [3/4] Building Next.js Application...
call npm run build

echo [4/4] Starting Production Server...
call npm run start
