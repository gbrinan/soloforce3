import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useT } from '../i18n/I18nProvider';

export function ShadcnPlayground() {
  const t = useT();
  return (
    <div className="p-8 space-y-6 bg-background text-foreground min-h-screen">
      <h1 className="text-2xl font-bold">shadcn/ui Playground</h1>
      <p className="text-sm text-muted-foreground">
        {t('playground.description')} <code className="bg-muted px-1 rounded">#shadcn-playground</code>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button>Primary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="xs">XS</Button>
        <Button size="sm">SM</Button>
        <Button>Default</Button>
        <Button size="lg">LG</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </div>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>{t('playground.cardDemoTitle')}</CardTitle>
          <CardDescription>{t('playground.cardDemoDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm">{t('playground.cardContentText')}</p>
          <div className="flex flex-wrap gap-2">
            <Badge>{t('playground.badgeActive')}</Badge>
            <Badge variant="secondary">{t('playground.badgeWaiting')}</Badge>
            <Badge variant="outline">{t('playground.badgeReference')}</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ShadcnPlayground;
