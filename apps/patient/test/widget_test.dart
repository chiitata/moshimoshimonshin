import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patient/main.dart';

void main() {
  testWidgets('サービスの説明と利用開始できない理由を表示する', (tester) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(const PatientApp());

    expect(find.text('もしもし問診へようこそ'), findsOneWidget);
    expect(find.text('医療機関に伝える患者情報の整理を支援するサービスです。'), findsOneWidget);
    expect(find.text('診断・治療・受診予約は行いません。'), findsOneWidget);
    expect(find.textContaining('認証・同意・利用開始後の画面が未実装'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    expect(
      tester.getSemantics(find.byType(FilledButton)),
      matchesSemantics(label: '利用開始', isButton: true, hasEnabledState: true),
    );
    await tester.tap(find.byType(FilledButton));
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.byType(WelcomeScreen), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('狭い画面と200%文字倍率でもスクロールして内容を確認できる', (tester) async {
    tester.view.physicalSize = const Size(320, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(2)),
          child: child!,
        ),
        home: const WelcomeScreen(),
      ),
    );
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text('利用開始'), 200);
    expect(find.textContaining('認証・同意・利用開始後の画面が未実装'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
