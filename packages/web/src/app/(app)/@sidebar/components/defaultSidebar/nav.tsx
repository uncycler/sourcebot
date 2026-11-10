"use client";

import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import { BookMarkedIcon, type LucideIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { NotificationDot } from "../../../components/notificationDot";
import { useMemo } from "react";
import Link from "next/link";

interface NavItem {
    title: string;
    href: string;
    icon: LucideIcon;
    key: string;
    requiresAuth?: boolean;
}

interface NavProps {
    isSettingsNotificationVisible?: boolean;
    isSignedIn?: boolean;
}

export function Nav({
    isSettingsNotificationVisible,
    isSignedIn,
}: NavProps) {
    const pathname = usePathname();

    const baseItems = useMemo((): NavItem[] => {

        const searchItem: NavItem = {
            title: "Code Search",
            href: "/search",
            icon: SearchIcon,
            key: "search",
        }

        return [
            searchItem,
            {
                title: "Repositories",
                href: "/repos",
                icon: BookMarkedIcon,
                key: "repos"
            },
            {
                title: "Settings",
                href: "/settings",
                icon: SettingsIcon,
                key: "settings",
                requiresAuth: true
            },
        ]


    }, []);

    const isActive = (href: string) => {
        if (pathname === "/") {
            return href === "/search";
        }

        if (href === "/search") {
            return pathname.startsWith("/search");
        }

        return pathname.startsWith(href);
    };

    return (
        <SidebarMenu>
            {baseItems
                .filter((item) => !item.requiresAuth || isSignedIn)
                .map((item) => {
                const showNotification =
                    (item.key === "settings" && isSettingsNotificationVisible);


                return (
                    <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.title}>
                            <Link
                                href={item.href}
                            >
                                <item.icon />
                                <span>{item.title}</span>
                                {showNotification && <NotificationDot className="ml-1.5" />}
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                );
            })}
        </SidebarMenu>
    );
}
