'use client';
import {createContext} from 'react';
/** Suspended workspaces retain state without exposing their portal pages. */
export const WorkspaceVisibility=createContext(true);
