export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      bridge_request_log: {
        Row: {
          received_at: string
          request_id: string
        }
        Insert: {
          received_at?: string
          request_id: string
        }
        Update: {
          received_at?: string
          request_id?: string
        }
        Relationships: []
      }
      connection_health: {
        Row: {
          checked_at: string
          error_message: string | null
          id: number
          last_market_data_at: string | null
          latency_ms: number | null
          status: Database["public"]["Enums"]["bridge_status"]
          terminal_connected: boolean
        }
        Insert: {
          checked_at?: string
          error_message?: string | null
          id?: never
          last_market_data_at?: string | null
          latency_ms?: number | null
          status?: Database["public"]["Enums"]["bridge_status"]
          terminal_connected?: boolean
        }
        Update: {
          checked_at?: string
          error_message?: string | null
          id?: never
          last_market_data_at?: string | null
          latency_ms?: number | null
          status?: Database["public"]["Enums"]["bridge_status"]
          terminal_connected?: boolean
        }
        Relationships: []
      }
      market_candles: {
        Row: {
          close: number
          high: number
          id: number
          low: number
          open: number
          open_time: string
          received_at: string
          source: Database["public"]["Enums"]["data_source"]
          spread: number | null
          symbol: string
          tick_volume: number | null
          timeframe: Database["public"]["Enums"]["timeframe"]
        }
        Insert: {
          close: number
          high: number
          id?: never
          low: number
          open: number
          open_time: string
          received_at?: string
          source: Database["public"]["Enums"]["data_source"]
          spread?: number | null
          symbol?: string
          tick_volume?: number | null
          timeframe: Database["public"]["Enums"]["timeframe"]
        }
        Update: {
          close?: number
          high?: number
          id?: never
          low?: number
          open?: number
          open_time?: string
          received_at?: string
          source?: Database["public"]["Enums"]["data_source"]
          spread?: number | null
          symbol?: string
          tick_volume?: number | null
          timeframe?: Database["public"]["Enums"]["timeframe"]
        }
        Relationships: []
      }
      market_ticks_latest: {
        Row: {
          ask: number
          bid: number
          price: number
          received_at: string
          symbol: string
          tick_time: string
        }
        Insert: {
          ask: number
          bid: number
          price: number
          received_at?: string
          symbol: string
          tick_time: string
        }
        Update: {
          ask?: number
          bid?: number
          price?: number
          received_at?: string
          symbol?: string
          tick_time?: string
        }
        Relationships: []
      }
      signal_outcomes: {
        Row: {
          closed_at: string
          created_at: string
          exit_price: number | null
          id: string
          max_adverse: number | null
          max_favorable: number | null
          outcome: Database["public"]["Enums"]["signal_outcome"]
          result_r: number | null
          signal_id: string
        }
        Insert: {
          closed_at?: string
          created_at?: string
          exit_price?: number | null
          id?: string
          max_adverse?: number | null
          max_favorable?: number | null
          outcome: Database["public"]["Enums"]["signal_outcome"]
          result_r?: number | null
          signal_id: string
        }
        Update: {
          closed_at?: string
          created_at?: string
          exit_price?: number | null
          id?: string
          max_adverse?: number | null
          max_favorable?: number | null
          outcome?: Database["public"]["Enums"]["signal_outcome"]
          result_r?: number | null
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_outcomes_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: true
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          confluence_score: number
          created_at: string
          entry: number
          entry_high: number | null
          entry_low: number | null
          expires_at: string
          id: string
          invalidated_at: string | null
          invalidation_rule: string | null
          is_demo: boolean
          reasons: string[]
          rr_tp1: number
          rr_tp2: number | null
          rr_worst: number | null
          side: Database["public"]["Enums"]["signal_side"]
          status: Database["public"]["Enums"]["signal_status"]
          stop_loss: number
          symbol: string
          take_profit_1: number
          take_profit_2: number | null
          timeframe: Database["public"]["Enums"]["timeframe"]
          updated_at: string
        }
        Insert: {
          confluence_score: number
          created_at?: string
          entry: number
          entry_high?: number | null
          entry_low?: number | null
          expires_at: string
          id?: string
          invalidated_at?: string | null
          invalidation_rule?: string | null
          is_demo?: boolean
          reasons?: string[]
          rr_tp1: number
          rr_tp2?: number | null
          rr_worst?: number | null
          side: Database["public"]["Enums"]["signal_side"]
          status?: Database["public"]["Enums"]["signal_status"]
          stop_loss: number
          symbol?: string
          take_profit_1: number
          take_profit_2?: number | null
          timeframe?: Database["public"]["Enums"]["timeframe"]
          updated_at?: string
        }
        Update: {
          confluence_score?: number
          created_at?: string
          entry?: number
          entry_high?: number | null
          entry_low?: number | null
          expires_at?: string
          id?: string
          invalidated_at?: string | null
          invalidation_rule?: string | null
          is_demo?: boolean
          reasons?: string[]
          rr_tp1?: number
          rr_tp2?: number | null
          rr_worst?: number | null
          side?: Database["public"]["Enums"]["signal_side"]
          status?: Database["public"]["Enums"]["signal_status"]
          stop_loss?: number
          symbol?: string
          take_profit_1?: number
          take_profit_2?: number | null
          timeframe?: Database["public"]["Enums"]["timeframe"]
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          active: boolean
          created_at: string
          ends_at: string | null
          granted_by: string | null
          id: string
          note: string | null
          starts_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          starts_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          ends_at?: string | null
          granted_by?: string | null
          id?: string
          note?: string | null
          starts_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_active_subscription: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      public_bridge_status: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "subscriber"
      bridge_status: "NOT_CONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR"
      data_source: "mt5_bridge" | "demo"
      signal_outcome: "tp1" | "tp2" | "sl" | "expired" | "invalidated"
      signal_side: "BUY" | "SELL"
      signal_status: "active" | "expired" | "invalidated" | "hit_tp" | "hit_sl"
      timeframe: "M5" | "M15"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "subscriber"],
      bridge_status: ["NOT_CONNECTED", "CONNECTING", "CONNECTED", "ERROR"],
      data_source: ["mt5_bridge", "demo"],
      signal_outcome: ["tp1", "tp2", "sl", "expired", "invalidated"],
      signal_side: ["BUY", "SELL"],
      signal_status: ["active", "expired", "invalidated", "hit_tp", "hit_sl"],
      timeframe: ["M5", "M15"],
    },
  },
} as const
