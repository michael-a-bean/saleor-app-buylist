import { Box, Text } from "@saleor/macaw-ui";
import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode } from "react";

interface NavItemProps {
  href: string;
  label: string;
  isActive: boolean;
}

const NavItem = ({ href, label, isActive }: NavItemProps) => (
  <Link href={href} style={{ textDecoration: "none" }}>
    <Box
      paddingX={4}
      paddingY={3}
      borderRadius={2}
      backgroundColor={isActive ? "default2" : undefined}
      cursor="pointer"
      className="nav-item"
    >
      <Text fontWeight={isActive ? "bold" : "regular"}>{label}</Text>
    </Box>
  </Link>
);

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const router = useRouter();
  const currentPath = router.pathname;

  const fohItems = [
    { href: "/buylists", label: "Buylists" },
    { href: "/buylists/new", label: "New Buylist" },
  ];

  const bohItems = [
    { href: "/boh/queue", label: "Review Queue" },
  ];

  const pricingItems = [
    { href: "/pricing/policies", label: "Pricing Policies" },
    // TODO: Price History page not yet implemented
    // { href: "/pricing/history", label: "Price History" },
  ];

  return (
    <Box display="flex" gap={6}>
      {/* Sidebar Navigation */}
      <Box
        __width="200px"
        __minWidth="200px"
        display="flex"
        flexDirection="column"
        gap={1}
        paddingTop={2}
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          <Box marginBottom={4}>
            <Text size={6} fontWeight="bold">
              Buylist
            </Text>
          </Box>
        </Link>

        {/* FOH Section */}
        <Box marginBottom={2}>
          <Text size={3} color="default2">
            Front of House
          </Text>
        </Box>
        {fohItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            isActive={
              item.href === "/buylists"
                ? currentPath === "/buylists" || currentPath.startsWith("/buylists/[id]")
                : currentPath === item.href
            }
          />
        ))}

        {/* BOH Section */}
        <Box marginTop={4} marginBottom={2}>
          <Text size={3} color="default2">
            Back of House
          </Text>
        </Box>
        {bohItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            isActive={currentPath.startsWith(item.href) || currentPath.startsWith("/boh/buylists")}
          />
        ))}

        {/* Pricing Section */}
        <Box marginTop={4} marginBottom={2}>
          <Text size={3} color="default2">
            Pricing
          </Text>
        </Box>
        {pricingItems.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            isActive={currentPath.startsWith(item.href)}
          />
        ))}
      </Box>

      {/* Main Content */}
      <Box __flex="1">{children}</Box>
    </Box>
  );
};
