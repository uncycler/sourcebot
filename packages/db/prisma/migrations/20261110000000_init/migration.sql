-- Installs the pgcrypto extension, used for gen_random_uuid() in the seed below.
-- @see: https://www.prisma.io/docs/orm/prisma-migrate/workflows/native-database-functions#how-to-install-a-postgresql-extension-as-part-of-a-migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "CodeHostType" AS ENUM ('github', 'gitlab', 'gitea', 'gerrit', 'bitbucket-server', 'bitbucket-cloud', 'generic-git-host', 'azuredevops');

-- CreateEnum
CREATE TYPE "ConnectionType" AS ENUM ('github', 'gitlab', 'gitea', 'gerrit', 'bitbucket', 'azuredevops', 'git');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateTable
CREATE TABLE "Repo" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isFork" BOOLEAN NOT NULL,
    "isArchived" BOOLEAN NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isAutoCleanupDisabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL,
    "cloneUrl" TEXT NOT NULL,
    "webUrl" TEXT,
    "imageUrl" TEXT,
    "defaultBranch" TEXT,
    "indexedAt" TIMESTAMP(3),
    "indexedCommitHash" TEXT,
    "latestIndexingJobId" TEXT,
    "firstIndexingJobFinishedAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "external_id" TEXT NOT NULL,
    "external_codeHostType" "CodeHostType" NOT NULL,
    "external_codeHostUrl" TEXT NOT NULL,
    "orgId" INTEGER NOT NULL,

    CONSTRAINT "Repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isDeclarative" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "connectionType" "ConnectionType" NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "latestSyncJobId" TEXT,
    "firstSyncJobFinishedAt" TIMESTAMP(3),
    "orgId" INTEGER NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoToConnection" (
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connectionId" INTEGER NOT NULL,
    "repoId" INTEGER NOT NULL,

    CONSTRAINT "RepoToConnection_pkey" PRIMARY KEY ("connectionId","repoId")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientEmail" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "orgId" INTEGER NOT NULL,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT NOT NULL,
    "orgId" INTEGER NOT NULL,

    CONSTRAINT "AccountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Org" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isOnboarded" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "memberApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "isCredentialsLoginEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isEmailCodeLoginEnabled" BOOLEAN NOT NULL DEFAULT false,
    "loginMessage" TEXT,
    "isAnonymousAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inviteLinkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inviteLinkId" TEXT,

    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserToOrg" (
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "suspendedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "UserToOrg_pkey" PRIMARY KEY ("orgId","userId")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "name" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "orgId" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "hashedPassword" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "RepoVisit" (
    "id" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPromotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repoId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" INTEGER NOT NULL,

    CONSTRAINT "RepoVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Repo_orgId_idx" ON "Repo"("orgId");

-- CreateIndex
CREATE INDEX "Repo_orgId_firstIndexingJobFinishedAt_idx" ON "Repo"("orgId", "firstIndexingJobFinishedAt");

-- CreateIndex
CREATE INDEX "Repo_indexedAt_idx" ON "Repo"("indexedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_external_id_external_codeHostUrl_orgId_key" ON "Repo"("external_id", "external_codeHostUrl", "orgId");

-- CreateIndex
CREATE INDEX "Connection_orgId_firstSyncJobFinishedAt_idx" ON "Connection"("orgId", "firstSyncJobFinishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_name_orgId_key" ON "Connection"("name", "orgId");

-- CreateIndex
CREATE INDEX "RepoToConnection_repoId_connectionId_idx" ON "RepoToConnection"("repoId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_recipientEmail_orgId_key" ON "Invite"("recipientEmail", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountRequest_requestedById_key" ON "AccountRequest"("requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "AccountRequest_requestedById_orgId_key" ON "AccountRequest"("requestedById", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_providerId_providerAccountId_key" ON "Account"("providerId", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "RepoVisit_userId_orgId_visitedAt_idx" ON "RepoVisit"("userId", "orgId", "visitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepoVisit_repoId_userId_key" ON "RepoVisit"("repoId", "userId");

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoToConnection" ADD CONSTRAINT "RepoToConnection_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoToConnection" ADD CONSTRAINT "RepoToConnection_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRequest" ADD CONSTRAINT "AccountRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRequest" ADD CONSTRAINT "AccountRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToOrg" ADD CONSTRAINT "UserToOrg_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToOrg" ADD CONSTRAINT "UserToOrg_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoVisit" ADD CONSTRAINT "RepoVisit_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoVisit" ADD CONSTRAINT "RepoVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoVisit" ADD CONSTRAINT "RepoVisit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the single tenant organization (see SINGLE_TENANT_ORG_ID in packages/web/src/lib/constants.ts).
INSERT INTO "Org" ("id", "name", "inviteLinkId", "createdAt", "updatedAt")
VALUES (1, 'default', gen_random_uuid(), NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
