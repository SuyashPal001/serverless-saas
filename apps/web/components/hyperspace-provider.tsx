"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import { HyperspaceLoader } from "./hyperspace-loader";

interface HyperspaceContextType {
    startHyperspace: () => void;
    finishHyperspace: () => void;
}

const HyperspaceContext = createContext<HyperspaceContextType | null>(null);

export function useHyperspace() {
    const ctx = useContext(HyperspaceContext);
    if (!ctx) throw new Error("useHyperspace must be used within HyperspaceProvider");
    return ctx;
}

export function HyperspaceProvider({ children }: { children: ReactNode }) {
    const [active, setActive] = useState(false);
    const [isDone, setIsDone] = useState(false);

    const startHyperspace = () => {
        setActive(true);
        setIsDone(false);
    };

    const finishHyperspace = () => {
        setIsDone(true);
    };

    const handleComplete = () => {
        // Animation sequence has fully finished, hide it.
        setActive(false);
    };

    return (
        <HyperspaceContext.Provider value={{ startHyperspace, finishHyperspace }}>
            {children}
            {/* The loader sits globally above everything */}
            <HyperspaceLoader 
                active={active} 
                isDone={isDone} 
                onComplete={handleComplete} 
            />
        </HyperspaceContext.Provider>
    );
}
