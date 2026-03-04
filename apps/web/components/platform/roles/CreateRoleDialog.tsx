"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreateRoleForm } from "./CreateRoleForm";

export function CreateRoleDialog() {
    const { permissions = [] } = useTenant();
    const [open, setOpen] = useState(false);

    if (!can(permissions, "roles", "create")) {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Create Role
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create New Role</DialogTitle>
                    <DialogDescription>
                        Define a new set of permissions for your team members.
                    </DialogDescription>
                </DialogHeader>
                <CreateRoleForm onSuccess={() => setOpen(false)} />
            </DialogContent>
        </Dialog>
    );
}
