import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as vscode from 'vscode';

export interface Project {
    id: string;
    name: string;
    description?: string;
}

export interface Feature {
    id: string;
    project_id: string;
    title: string;  // Changed from 'name' to 'title'
    description: string;  // This is the actual prompt/instruction
    is_used?: boolean;
    auto_generated_name?: string;
}

export class SupabaseService {
    private supabase: SupabaseClient;
    private static instance: SupabaseService;

    private constructor() {
        const supabaseUrl = 'https://tkuwflfjajejswvliroc.supabase.co';
        const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrdXdmbGZqYWplanN3dmxpcm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI5NzQxNDQsImV4cCI6MjA3ODU1MDE0NH0.0Nf6BQjH9Z2PAcwN--ANEwMxvp8oReKHjO8d8y6Ab08';

        this.supabase = createClient(supabaseUrl, supabaseAnonKey);
    }

    public static getInstance(): SupabaseService {
        if (!SupabaseService.instance) {
            SupabaseService.instance = new SupabaseService();
        }
        return SupabaseService.instance;
    }

    public async signIn(email: string, password: string) {
        try {
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                throw error;
            }

            return data;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Login failed: ${error.message}`);
            throw error;
        }
    }

    public async signOut() {
        const { error } = await this.supabase.auth.signOut();
        if (error) {
            throw error;
        }
    }

    public async getCurrentUser() {
        const { data: { user } } = await this.supabase.auth.getUser();
        return user;
    }

    public async getProjects(): Promise<Project[]> {
        try {
            const { data, error } = await this.supabase
                .from('projects')
                .select('*')
                .order('name');

            if (error) {
                throw error;
            }

            return data || [];
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to fetch projects: ${error.message}`);
            return [];
        }
    }

    public async getFeatures(projectId: string): Promise<Feature[]> {
        try {
            const { data, error } = await this.supabase
                .from('features')
                .select('*')
                .eq('project_id', projectId)
                .order('title');

            if (error) {
                throw error;
            }

            return data || [];
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to fetch features: ${error.message}`);
            return [];
        }
    }

    public getSupabaseClient(): SupabaseClient {
        return this.supabase;
    }
}