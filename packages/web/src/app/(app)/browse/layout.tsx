import { LayoutClient } from "./layoutClient";

interface LayoutProps {
    children: React.ReactNode;
}

export default function Layout({
    children,
}: LayoutProps) {
    return (
        <LayoutClient>
            {children}
        </LayoutClient>
    )
}
