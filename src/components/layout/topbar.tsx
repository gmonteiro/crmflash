"use client"

import { UserMenu } from "./user-menu"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TopbarProps {
  email: string | undefined
  onMenuClick: () => void
}

export function Topbar({ email, onMenuClick }: TopbarProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <div className="flex-1" />
      <UserMenu email={email} />
    </header>
  )
}
