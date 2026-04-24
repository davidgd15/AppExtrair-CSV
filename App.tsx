import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  FlatList,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { db } from './firebaseConfig';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';

// ---------- Tipagens ----------
type Module = {
  id: number;
  code: string;
  timestamp: string;
};

type Batch = {
  id?: string;
  batchId: string;
  modules: Module[];
  createdAt: string;
  synced?: boolean;
};

// ---------- Função de formatação ----------
const formatDateTime = (date: Date): string => {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
};

// ---------- App Supervisor ----------
export default function App() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchBatches = useCallback(async () => {
    try {
      const q = query(collection(db, 'batches'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const loaded: Batch[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          batchId: data.batchId ?? 'Sem ID',
          modules: Array.isArray(data.modules) ? data.modules : [],
          createdAt: data.createdAt ?? '',
          synced: true,
        };
      });

      setBatches(loaded);
    } catch (error) {
      Alert.alert('Erro', 'Falha ao carregar os lotes do servidor.');
      console.error(error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Carregar na montagem inicial
  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Função de exportação CSV (com separador ; e BOM)
  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // BOM + cabeçalho com ;
      let csvContent = '\uFEFF' + 'Lote;ID Modulo;Número de Série\n';

      batches.forEach((batch) => {
        batch.modules.forEach((mod) => {
          // Escapa aspas duplas dentro do código
          const escapedCode = `"${mod.code.replace(/"/g, '""')}"`;
          csvContent += `${batch.batchId};${mod.id};${escapedCode}\n`;
        });
        // Se quiser incluir lotes vazios, descomente a linha abaixo:
        // if (batch.modules.length === 0) { csvContent += `${batch.batchId};;\n`; }
      });

      const fileName = `lotes_${formatDateTime(new Date()).replace(/[/: ]/g, '_')}.csv`;
      const filePath = FileSystem.documentDirectory + fileName;

      await FileSystem.writeAsStringAsync(filePath, csvContent, {
        encoding: 'utf8',
      });

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'text/csv',
          dialogTitle: 'Exportar lotes (CSV)',
        });
      } else {
        Alert.alert('Exportado', `Arquivo salvo em: ${filePath}`);
      }
    } catch (error) {
      Alert.alert('Erro', 'Falha ao exportar os dados.');
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  // Tela de carregamento inicial
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1976d2" />
        <Text>Carregando lotes...</Text>
      </View>
    );
  }

  // Interface principal
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Modo Supervisor</Text>
      <Text style={styles.subtitle}>
        {batches.length} lote(s) encontrado(s)
      </Text>

      {/* Botões de ação */}
      <View style={styles.actionRow}>
        <Button
          title={refreshing ? 'Atualizando...' : 'Atualizar lista'}
          onPress={() => {
            setRefreshing(true);
            fetchBatches();
          }}
          disabled={refreshing}
        />
        <Button
          title={exporting ? 'Exportando...' : 'Exportar lotes (CSV)'}
          onPress={exportData}
          disabled={exporting}
        />
      </View>

      {/* Lista de lotes */}
      <FlatList
        data={batches}
        keyExtractor={(item, index) => item.id ?? index.toString()}
        style={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Lote {item.batchId}</Text>
            <Text style={styles.cardSubtitle}>
              {item.modules.length} módulo(s) • {item.createdAt}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Nenhum lote disponível.</Text>
        }
      />
    </View>
  );
}

// ---------- Estilos ----------
const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 20, color: '#555' },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
  },
  list: { flex: 1, marginTop: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    elevation: 2,
  },
  cardTitle: { fontWeight: 'bold', fontSize: 16 },
  cardSubtitle: { color: '#555', marginTop: 4 },
  emptyText: { textAlign: 'center', marginTop: 20, color: '#888' },
});