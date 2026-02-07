import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getMergedSettings, getSyncSettings, setSyncSettings, Settings } from '@/lib/settings'
import { toast } from 'sonner'
import { FaDiscord } from 'react-icons/fa'
import { langs, ToLang } from '../../../lib/translate/lang'

export function OptionsForm() {
  const queryClient = useQueryClient()

  // Load merged settings for display
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['settings'],
    queryFn: getMergedSettings,
  })

  // Save settings mutation
  const saveMutation = useMutation({
    mutationFn: setSyncSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (error) => {
      toast.error('Failed to save settings')
      console.error(error)
    },
  })

  // Auto-save function - only save user settings, not defaults
  const updateSetting = async (updates: Partial<Settings>) => {
    const syncSettings = await getSyncSettings()
    const newSettings = { ...syncSettings, ...updates }
    saveMutation.mutate(newSettings)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-destructive">
          Error loading settings: {error.message}
        </div>
      </div>
    )
  }

  if (!settings) return null

  const currentEngine = settings.engine || 'microsoft'

  return (
    <div className="container max-w-4xl mx-auto px-2 py-4 md:px-0 md:py-8 space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">BilingualTube Settings</h1>
          <a
            href="https://discord.gg/C2baQRZUCW"
            target="_blank"
            rel="noopener noreferrer"
            title="Join our Discord"
            className="text-[#5865F2] hover:text-[#4752C4] transition-colors"
          >
            <FaDiscord size={24} />
          </a>
        </div>
        <p className="text-muted-foreground">
          Configure your translation preferences and API settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Translation Settings</CardTitle>
          <CardDescription>
            Configure the translation engine and target language
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Target Language - Always visible */}
          <div className="space-y-2">
            <Label htmlFor="to">Target Language</Label>
            <Select
              value={settings.to || 'en'}
              onValueChange={(value) => updateSetting({ to: value as ToLang })}
            >
              <SelectTrigger id="to">
                <SelectValue placeholder="Select target language" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(langs)
                  .filter(([code]) => code !== 'auto')
                  .sort(([, nameA], [, nameB]) => nameA.localeCompare(nameB))
                  .map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Engine - Always visible */}
          <div className="space-y-2">
            <Label htmlFor="engine">Engine</Label>
            <Select
              value={currentEngine}
              onValueChange={(value) =>
                updateSetting({ engine: value as 'microsoft' | 'openai' })
              }
            >
              <SelectTrigger id="engine">
                <SelectValue placeholder="Select translation engine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="microsoft">Microsoft</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* OpenAI-specific fields - Only visible when engine is 'openai' */}
          {currentEngine === 'openai' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="openai-api-key">OpenAI API Key</Label>
                <Input
                  id="openai-api-key"
                  type="password"
                  placeholder="sk-..."
                  value={settings['openai.apiKey'] || ''}
                  onChange={(e) =>
                    updateSetting({ 'openai.apiKey': e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="openai-model">OpenAI Model</Label>
                <Input
                  id="openai-model"
                  type="text"
                  placeholder="gpt-4.1-mini"
                  value={settings['openai.model'] || ''}
                  onChange={(e) =>
                    updateSetting({ 'openai.model': e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="openai-base-url">OpenAI Base URL</Label>
                <Input
                  id="openai-base-url"
                  type="url"
                  placeholder="https://api.openai.com/v1"
                  value={settings['openai.baseUrl'] || ''}
                  onChange={(e) =>
                    updateSetting({ 'openai.baseUrl': e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="openai-prompt">OpenAI Prompt</Label>
                <Textarea
                  id="openai-prompt"
                  placeholder="Enter custom translation prompt..."
                  value={settings['openai.prompt'] || ''}
                  onChange={(e) =>
                    updateSetting({ 'openai.prompt': e.target.value })
                  }
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
