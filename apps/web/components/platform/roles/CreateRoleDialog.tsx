"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { canCreate } from "@/lib/permissions";
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
import { UpgradePrompt } from "@/components/platform/UpgradePrompt";

export function CreateRoleDialog() {
    const { permissions = [], entitlementFeatures } = useTenant();
    const [open, setOpen] = useState(false);
    const [upgradeOpen, setUpgradeOpen] = useState(false);

    if (!canCreate(permissions, "roles")) {
        return null;
    }

    const canCreateRoles = entitlementFeatures?.['custom_roles'] === true;

    if (!canCreateRoles) {
        return (
            <p className="text-xs text-muted-foreground">
                Custom roles available on Business plan
            </p>
        );
    }

    const handleUpgradeRequired = () => {
        setOpen(false);
        setUpgradeOpen(true);
    };

    return (
        <>
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
                    <CreateRoleForm
                        onSuccess={() => setOpen(false)}
                        onUpgradeRequired={handleUpgradeRequired}
                    />
                </DialogContent>
            </Dialog>

            <UpgradePrompt
                open={upgradeOpen}
                onClose={() => setUpgradeOpen(false)}
                feature="custom_roles"
            />
        </>
    );
}
