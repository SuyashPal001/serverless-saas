"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { CreateAgentForm } from "./CreateAgentForm";

export function CreateAgentDialog() {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Agent
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create New Agent</DialogTitle>
                    <DialogDescription>
                        Configure a new agent for your tenant.
                    </DialogDescription>
                </DialogHeader>
                <CreateAgentForm onSuccess={() => setOpen(false)} />
            </DialogContent>
        </Dialog>
    );
}
