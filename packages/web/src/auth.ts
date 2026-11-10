import 'next-auth/jwt';
import { cache } from "react";
import NextAuth, { DefaultSession, Session, User as AuthJsUser } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import EmailProvider from "next-auth/providers/nodemailer";
import { __unsafePrisma } from "@/prisma";
import { env, getSMTPConnectionURL } from "@sourcebot/shared";
import { User } from '@sourcebot/db';
import 'next-auth/jwt';
import type { Provider } from "next-auth/providers";
import { verifyCredentialsRequestSchema } from './lib/schemas';
import { createTransport } from 'nodemailer';
import { render } from '@react-email/render';
import MagicLinkEmail from './emails/magicLinkEmail';
import bcrypt from 'bcryptjs';
import { SINGLE_TENANT_ORG_ID } from './lib/constants';
import { EncryptedPrismaAdapter } from '@/lib/encryptedPrismaAdapter';
import { isEmailCodeLoginEnabled, isCredentialsLoginEnabled } from '@sourcebot/shared'
import { onCreateUser } from './features/membership/onCreateUser';

export const runtime = 'nodejs';

export type IdentityProvider = {
    /** Provider type (e.g., 'github', 'gitlab') — used to pick icon / display defaults. */
    type: string;
    /** Provider instance id (e.g., 'github', 'gitlab-corp') — used for `signIn(provider)`. */
    id: string;
    /** Optional admin-supplied display name from config; overrides type-derived defaults in the UI. */
    displayName?: string;
    purpose: "sso";
    /**
     * @warning don't use this field directly - this is meant to be
     * passed directly to auth.js. Use the fields directly on the
     * IdentityProvider type (i.e., `type`, `id`, etc.)
     * 
     * @deprecated this field isn't actually deprected, but adding
     * this tag to dissuade usage.
     */
    __provider: Provider;
}

export type SessionUser = {
    id: string;
} & DefaultSession['user'];

declare module 'next-auth' {
    interface Session {
        user: SessionUser;
        sessionVersion?: number;
    }
    interface User {
        sessionVersion?: number;
    }
}

declare module 'next-auth/jwt' {
    interface JWT {
        userId: string;
        sessionVersion?: number;
    }
}

export const getProviders = async () => {
    const providers: IdentityProvider[] = [];
    const org = await __unsafePrisma.org.findUnique({ where: { id: SINGLE_TENANT_ORG_ID } });

    const smtpConnectionUrl = getSMTPConnectionURL();
    if (smtpConnectionUrl && env.EMAIL_FROM_ADDRESS && isEmailCodeLoginEnabled(org!)) {
        providers.push({
            __provider: EmailProvider({
                server: smtpConnectionUrl,
                from: env.EMAIL_FROM_ADDRESS,
                maxAge: 60 * 10,
                generateVerificationToken: async () => {
                    const token = String(Math.floor(100000 + Math.random() * 900000));
                    return token;
                },
                sendVerificationRequest: async ({ identifier, provider, token }) => {
                    const transport = createTransport(provider.server);
                    const html = await render(MagicLinkEmail({ token: token }));
                    const result = await transport.sendMail({
                        to: identifier,
                        from: provider.from,
                        subject: 'Log in to Sourcebot',
                        html,
                        text: `Log in to Sourcebot using this code: ${token}`
                    });

                    const failed = result.rejected.concat(result.pending ?? []).filter(Boolean);
                    if (failed.length) {
                        throw new Error(`Email(s) (${failed.join(", ")}) could not be sent`);
                    }
                },
            }),
            type: "nodemailer",
            id: "nodemailer",
            purpose: "sso",
        });
    }

    if (isCredentialsLoginEnabled(org!)) {
        providers.push({
            __provider: Credentials({
                credentials: {
                    email: {},
                    password: {}
                },
                type: "credentials",
                authorize: async (credentials) => {
                    const body = verifyCredentialsRequestSchema.safeParse(credentials);
                    if (!body.success) {
                        return null;
                    }
                    const { email, password } = body.data;

                    const user = await __unsafePrisma.user.findUnique({
                        where: { email }
                    });

                    // The user doesn't exist, so create a new one.
                    if (!user) {
                        const hashedPassword = bcrypt.hashSync(password, 10);
                        const newUser = await __unsafePrisma.user.create({
                            data: {
                                email,
                                hashedPassword,
                            }
                        });

                        const authJsUser: AuthJsUser = {
                            id: newUser.id,
                            email: newUser.email,
                            sessionVersion: newUser.sessionVersion,
                        }

                        await onCreateUser({ user: authJsUser });
                        return authJsUser;

                        // Otherwise, the user exists, so verify the password.
                    } else {
                        if (!user.hashedPassword) {
                            return null;
                    }

                        if (!bcrypt.compareSync(password, user.hashedPassword)) {
                            return null;
                        }

                        return {
                            id: user.id,
                            email: user.email,
                            name: user.name ?? undefined,
                            image: user.image ?? undefined,
                            sessionVersion: user.sessionVersion,
                        };
                    }
                }
            }),
            type: "credentials",
            id: "credentials",
            purpose: "sso"
        });
    }

    return providers;
}

// @note we use lazy initialization here to ensure that the
// `providers` property is upto date with any config changes.
// @see https://authjs.dev/reference/nextjs#lazy-initialization
const nextAuthResult = NextAuth(async () => ({
    secret: env.AUTH_SECRET,
    adapter: EncryptedPrismaAdapter(__unsafePrisma),
    session: {
        strategy: "jwt",
        maxAge: env.AUTH_SESSION_MAX_AGE_SECONDS,
        updateAge: env.AUTH_SESSION_UPDATE_AGE_SECONDS,
    },
    trustHost: true,
    events: {
        createUser: onCreateUser,
        signOut: async (message) => {
            const token = message as { token: { userId: string } | null };
            if (token?.token?.userId) {
                // Bump sessionVersion so any JWT minted before this signout
                // is treated as invalid by the jwt callback's DB cross-check
                // on its next request, even if the cookie value was captured
                // and is being replayed.
                await __unsafePrisma.user.update({
                    where: { id: token.token.userId },
                    data: { sessionVersion: { increment: 1 } },
                });

            }
        }
    },
    callbacks: {
        async signIn({ user }) {
            // Reject any sign-in that arrives without an email.
            // `User.email` is required in packages/db/prisma/schema.prisma.
            if (!user.email) {
                return '/login/error?error=EmailRequired';
            }

            return true;
        },
        // Restrict post-auth redirects (sign-in / sign-out, `callbackUrl`,
        // `redirectTo`) to the same origin as the application. This mirrors
        // Auth.js's documented default; we set it explicitly so the protection
        // is visible in code and not dependent on upstream defaults.
        // @see https://authjs.dev/reference/core#redirect
        async redirect({ url, baseUrl }) {
            if (url.startsWith("/")) {
                return `${baseUrl}${url}`;
            }

            try {
                if (new URL(url).origin === baseUrl) {
                    return url;
                }
            } catch {
                // Malformed URL — fall through to baseUrl.
            }

            return baseUrl;
        },
        async jwt({ token, user: _user }) {
            const user = _user as User | undefined;
            // @note: `user` will be available on signUp or signIn triggers.
            // Cache the userId in the JWT for later use.
            if (user) {
                token.userId = user.id;
                token.sessionVersion = user.sessionVersion ?? 0;
            }

            if (token.userId) {
                // Fetch the user's current sessionVersion for the cross-check below.
                const dbUser = await __unsafePrisma.user.findUnique({
                    where: {
                        id: token.userId as string,
                    },
                    select: {
                        sessionVersion: true,
                    },
                });

                // The user row was removed (e.g., by an org-removal cascade). Treat the JWT as invalid so
                // /api/auth/session reports logged-out and @auth/core clears
                // the cookie from the browser.
                if (!dbUser) {
                    return null;
                }

                // On every non-login request, cross-check the JWT's
                // sessionVersion against the user's current sessionVersion in
                // the database. A mismatch means the user signed out, was
                // removed from the org, or their sessions were otherwise
                // invalidated since the JWT was minted. Returning null here
                // is what makes invalidation visible at /api/auth/session,
                // not just at withAuth-gated endpoints.
                const tokenSessionVersion = token.sessionVersion ?? 0;
                if (!user && tokenSessionVersion !== dbUser.sessionVersion) {
                    return null;
                }

            }

            return token;
        },
        async session({ session, token }) {
            // @WARNING: Anything stored in the session will be sent over
            // to the client.
            session.user = {
                ...session.user,
                // Propagate the userId to the session.
                id: token.userId,
            }
            session.sessionVersion = token.sessionVersion;

            return session;
        },
    },
    providers: (await getProviders()).map((provider) => provider.__provider),
    pages: {
        signIn: "/login",
        error: "/login/error",
        // We set redirect to false in signInOptions so we can pass the email in as a param
        // verifyRequest: "/login/verify",
    }
}));

export const { handlers, signIn, signOut } = nextAuthResult;

/**
 * Per-request memoized session resolver.
 *
 * JWT validity (including the `sessionVersion` cross-check against the
 * database and the existence of the underlying `User` row) is enforced in
 * the `jwt` callback above. If that callback returns `null`, NextAuth's
 * core resolves the session to `null` here and also clears the cookie on
 * the response. We therefore only need to memoize the result within a
 * single request so that multiple `auth()` callers share the same answer
 * without re-running the upstream resolver.
 */
export const auth = cache(async (): Promise<Session | null> => {
    const session = await nextAuthResult.auth();
    return session;
});

